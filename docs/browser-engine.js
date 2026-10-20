import {ZipReader,BlobReader,BlobWriter,configure,sha256,sha1,bytesToHex} from './vendor/archive.js';
import {BrowserPCloud,Retryable,AuthError,abort} from './browser-pcloud.js';
import {cleanupState,inventoryFingerprint} from './cleanup.js';
configure({useWebWorkers:false,useCompressionStream:true,chunkSize:1024*1024});
const text=new TextEncoder();
const parent=path=>path.includes('/')?path.slice(0,path.lastIndexOf('/')):'.';
const basename=path=>path.split('/').pop();
const media=/\.(jpe?g|png|gif|webp|heic|heif|avif|tiff?|bmp|dng|raw|cr[23]|nef|arw|raf|orf|rw2|srw|pef|mp4|mov|m4v|avi|mkv|webm|mpg|mpeg|3gp|mts|m2ts|mod|wmv|flv|insv)$/i;
export function safeName(path){
  let name=basename(path).replace(/[\\\0\r\n\x01-\x1f]/g,char=>'_'+char.charCodeAt(0).toString(16)+'_');
  if(!name||name==='.'||name==='..')name='fichier';
  while(text.encode(name).length>1000)name=Array.from(name).slice(0,-1).join('');
  return name;
}
export function archiveFingerprint(entries){return bytesToHex(sha256(text.encode(JSON.stringify(entries.map(entry=>[entry.filename,entry.crc32,entry.uncompressedSize,entry.compressedSize,entry.offset,entry.encrypted,entry.compressionMethod])))));}
export async function hashEntry(entry,signal,progress=()=>{}){
  if(entry.encrypted)throw new Error('Les ZIP chiffrés ne sont pas pris en charge.');
  const h256=sha256.create(),h1=sha1.create();let count=0;
  const collect=/\.json$/i.test(entry.filename)&&entry.uncompressedSize<=4*1024*1024;
  const chunks=[];
  await entry.getData(new WritableStream({write(chunk){abort(signal);h256.update(chunk);h1.update(chunk);count+=chunk.byteLength;if(collect)chunks.push(chunk.slice());progress(count,entry.uncompressedSize);}}),{signal,checkCrc32:true,checkSignature:true});
  if(count!==entry.uncompressedSize)throw new Error('Taille ZIP incorrecte : '+entry.filename);
  let date;
  if(collect)try{
    const data=JSON.parse(await new Blob(chunks).text()),stamp=Number(data.photoTakenTime?.timestamp);
    if(typeof data.title==='string'&&Number.isSafeInteger(stamp)&&stamp>=-62135596800&&stamp<=253402300799){const match=parent(entry.filename)+'\0'+data.title;date={id:match+'\0'+stamp,match,stamp};}
  }catch{}
  return {sha256:bytesToHex(h256.digest()),sha1:bytesToHex(h1.digest()),size:count,date};
}

async function stageEntry(entry,object,signal,progress){
  // Keep one extracted media in browser-private disk storage, never a whole ZIP.
  // Browsers cannot reliably stream an unknown-length multipart request to pCloud.
  let directory,handle,writable,blob;
  if(navigator.storage?.getDirectory){
    const estimate=await navigator.storage.estimate();
    if(estimate.quota&&estimate.quota-estimate.usage<object.size+16*1024*1024)throw new Error('Espace temporaire du navigateur insuffisant pour ce fichier. Libérez de la place puis reprenez.');
    directory=await navigator.storage.getDirectory();
    handle=await directory.getFileHandle('passage-photos-transfer.tmp',{create:true});
    writable=await handle.createWritable();
  }else if(object.size>128*1024*1024)throw new Error('Ce navigateur ne permet pas de préparer un fichier de plus de 128 Mo. Utilisez Chrome ou Edge récent.');
  const digest=sha256.create();let count=0;
  try{
    if(writable){
      await entry.getData(new WritableStream({
        async write(chunk){abort(signal);digest.update(chunk);count+=chunk.byteLength;await writable.write(chunk);progress(count,object.size);},
        async close(){await writable.close();},
        async abort(){await writable.abort().catch(()=>{});}
      }),{signal,checkCrc32:true,checkSignature:true});
      blob=await handle.getFile();
    }else{
      blob=await entry.getData(new BlobWriter(),{signal,checkCrc32:true,checkSignature:true});
      const reader=blob.stream().getReader();
      while(true){abort(signal);const {value,done}=await reader.read();if(done)break;digest.update(value);count+=value.byteLength;progress(count,object.size);}
    }
    if(count!==object.size||bytesToHex(digest.digest())!==object.sha256)throw new Error('La source diffère de l’inventaire. Aucun envoi effectué.');
    return {blob,release:async()=>{if(directory)await directory.removeEntry('passage-photos-transfer.tmp').catch(()=>{});}};
  }catch(error){
    if(writable)await writable.abort().catch(()=>{});
    if(directory)await directory.removeEntry('passage-photos-transfer.tmp').catch(()=>{});
    throw error;
  }
}

export class BrowserMigration{
  constructor(journal,notify=()=>{}){
    this.journal=journal;this.notify=notify;this.objects=new Map();this.archives=new Map();
    this.selected=[];this.openArchives=new Map();this.settings={folder:'Ma phototheque',client_id:'',folders:{}};
    this.auth=null;this.identity=null;this.job={command:null,running:false,exit_code:null,paused:false};this.logs=[];this.sequence=0;
  }
  async load(){
    this.objects=new Map((await this.journal.all('objects')).map(row=>[row.id,row]));
    this.archives=new Map((await this.journal.all('archives')).map(row=>[row.id,row]));
    this.settings={folder:'Ma phototheque',client_id:'',folders:{},...Object.fromEntries((await this.journal.all('settings')).map(row=>[row.id,row.value]))};
  }
  log(line){this.logs.push(line);if(this.logs.length>160)this.logs.shift();this.sequence++;this.notify();}
  async setting(id,value){await this.journal.put('settings',{id,value});this.settings[id]=value;}
  async save(object){await this.journal.put('objects',object);this.objects.set(object.id,object);}
  pause(){this.controller?.abort(new DOMException('Opération mise en pause.','AbortError'));}
  async task(command,operation){
    if(this.job.running)throw new Error('Une opération est déjà en cours.');
    if(!navigator.locks)throw new Error('Ce navigateur ne permet pas le verrouillage de reprise. Utilisez Chrome, Edge ou Firefox récent.');
    return navigator.locks.request('passage-photos-browser-migration',{ifAvailable:true},async lock=>{
      if(!lock)throw new Error('Une migration est déjà ouverte dans un autre onglet.');
      this.controller=new AbortController();this.job={command,running:true,exit_code:null,paused:false};this.logs=[];this.sequence++;this.notify();
      let wake;
      try{
        await this.load();
        // Only our own disposable media is removed, never user-selected archives.
        if(navigator.storage?.getDirectory){const dir=await navigator.storage.getDirectory();await dir.removeEntry('passage-photos-transfer.tmp').catch(()=>{});}
        try{wake=await navigator.wakeLock?.request('screen');}catch{}
        await operation(this.controller.signal);
        this.job.exit_code=0;
      }catch(error){
        this.job.exit_code=2;
        if(this.controller.signal.aborted){this.job.paused=true;this.log('Opération interrompue. Le journal est conservé pour la reprise.');}
        else{this.log('Arrêt : '+error.message);throw error;}
      }finally{this.job.running=false;await wake?.release().catch(()=>{});this.notify();}
    });
  }
  async select(files){
    if(this.job.running)throw new Error('Mettez l’opération en pause avant de changer les ZIP.');
    for(const archive of this.openArchives.values())await archive.reader.close();
    this.openArchives.clear();this.selected=Array.from(files);
    if(!this.selected.every(file=>/\.zip$/i.test(file.name)))throw new Error('Choisissez uniquement des archives ZIP.');
    this.notify();
  }
  async prepare(signal){
    for(const file of this.selected){
      abort(signal);
      if([...this.openArchives.values()].some(item=>item.file===file))continue;
      const reader=new ZipReader(new BlobReader(file));
      try{
        const entries=await reader.getEntries({signal});
        const id=archiveFingerprint(entries);
        this.openArchives.set(id,{file,reader,entries});
      }catch(error){await reader.close();throw error;}
    }
  }
  async scan(signal){
    await this.setting('cleanup-audit',null);
    if(!this.selected.length)throw new Error('Choisissez les ZIP Takeout.');
    await this.prepare(signal);
    for(const [id,opened] of this.openArchives){
      let archive=this.archives.get(id);
      if(archive?.complete){this.log('Déjà analysée : '+opened.file.name);continue;}
      archive={id,name:opened.file.name,size:opened.file.size,complete:false};
      await this.journal.put('archives',archive);this.archives.set(id,archive);
      this.log('Analyse et contrôle CRC : '+archive.name);
      const known=new Set((await this.journal.all('sources','archive',id)).map(source=>source.ordinal));
      for(let ordinal=0;ordinal<opened.entries.length;ordinal++){
        abort(signal);const entry=opened.entries[ordinal];
        if(entry.directory||known.has(ordinal))continue;
        this.log(`Lecture ${ordinal+1}/${opened.entries.length} : ${entry.filename}`);
        let last=0;
        const hash=await hashEntry(entry,signal,(count,total)=>{if(Date.now()-last>1000){last=Date.now();this.notify({detail:`Analyse : ${count.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')} octets`});}});
        const object={id:hash.sha256,sha256:hash.sha256,sha1:hash.sha1,size:hash.size,name:safeName(entry.filename),category:media.test(entry.filename)?'Medias':/\.json$/i.test(entry.filename)?'Metadonnees':'Autres',captured:null,folderid:null,fileid:null,status:'pending',error:null,checked:null};
        await this.journal.entry(object,{id:id+':'+ordinal,archive:id,ordinal,path:entry.filename,digest:hash.sha256},hash.date);
        if(!this.objects.has(object.id))this.objects.set(object.id,object);
        this.notify();
      }
      archive.complete=true;await this.journal.put('archives',archive);this.log('Archive analysée : '+archive.name);
    }
    await this.applyDates(signal);
  }
  async applyDates(signal){
    const dates=new Map();
    for(const row of await this.journal.all('dates')){if(!dates.has(row.match))dates.set(row.match,new Set());dates.get(row.match).add(row.stamp);}
    const matches=new Map();
    for(const source of await this.journal.all('sources')){
      const stamps=dates.get(parent(source.path)+'\0'+basename(source.path));
      if(stamps){if(!matches.has(source.digest))matches.set(source.digest,new Set());for(const stamp of stamps)matches.get(source.digest).add(stamp);}
    }
    for(const object of this.objects.values()){
      abort(signal);if(object.status==='verified')continue;
      const stamps=matches.get(object.id),captured=stamps?.size===1?[...stamps][0]:null;
      if(captured!==object.captured)await this.save({...object,captured});
    }
  }
  client(signal){return new BrowserPCloud(this.auth,signal,message=>this.notify({detail:message}));}
  async identify(signal){
    const user=await this.client(signal).call('userinfo');
    const binding=this.settings.binding;
    if(binding&&(binding.userid!==user.userid||binding.host!==this.auth.host))throw new AuthError('Le journal appartient à un autre compte ou une autre région pCloud.');
    this.identity=user;this.notify();return user;
  }
  async bind(client,signal){
    const user=await this.identify(signal);
    if(this.settings.binding){await client.call('listfolder',{folderid:this.settings.binding.folderid,nofiles:1});return this.settings.binding.folderid;}
    const name=this.settings.folder?.trim();
    if(!name||safeName(name)!==name||/[\/\\]/.test(name))throw new Error('Choisissez un nom de dossier pCloud simple, sans séparateur.');
    const folderid=await client.folder(0,name);
    await this.setting('binding',{userid:user.userid,host:this.auth.host,folderid,initial_name:name});return folderid;
  }
  async folder(client,object,root){
    if(object.folderid!=null)return object.folderid;
    const folders={...this.settings.folders};
    if(!folders.files)folders.files=await client.folder(root,'Fichiers');
    const prefix=object.id.slice(0,2);
    if(!folders[prefix])folders[prefix]=await client.folder(folders.files,prefix);
    await this.setting('folders',folders);
    const folderid=await client.folder(folders[prefix],object.id);
    await this.save({...object,folderid});return folderid;
  }
  async source(object){
    for(const source of await this.journal.all('sources','digest',object.id)){
      const opened=this.openArchives.get(source.archive);
      if(opened)return opened.entries[source.ordinal];
    }
    throw new Error('ZIP source non sélectionné. Choisissez à nouveau la partie contenant ce fichier, puis reprenez.');
  }
  async verified(object,fileid){await this.save({...this.objects.get(object.id),fileid,status:'verified',error:null,checked:new Date().toISOString()});}
  async transferOne(client,object,root,signal){
    for(let attempt=0;attempt<6;attempt++){
      let staged;
      try{
        const folderid=await this.folder(client,object,root),contents=await client.contents(folderid);
        if(contents.length){
          if(contents.length!==1||contents[0].isfolder||!await client.matches(object,contents[0].fileid))throw new Error('Contenu distant inattendu ou corrompu. Aucun écrasement : inspectez ce sous-dossier sur pCloud.');
          await this.verified(object,contents[0].fileid);return;
        }
        abort(signal);
        const entry=await this.source(object);
        this.notify({detail:'Préparation locale de '+object.name});
        staged=await stageEntry(entry,object,signal,(count,total)=>this.notify({detail:`Préparation : ${count.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')} octets`}));
        await this.save({...this.objects.get(object.id),status:'uploading',error:null});
        this.notify({detail:'Envoi à pCloud : '+object.name});
        const fileid=await client.upload(object,staged.blob,folderid);
        await this.save({...this.objects.get(object.id),fileid});
        if(!await client.matches(object,fileid))throw new Error('Empreintes différentes après envoi. Validation refusée.');
        await this.verified(object,fileid);return;
      }catch(error){abort(signal);if(!(error instanceof Retryable)||attempt===5)throw error;await client.retry(attempt,error);}
      finally{await staged?.release();}
    }
  }
  async run(signal){
    await this.setting('cleanup-audit',null);
    if(!this.objects.size||[...this.archives.values()].some(row=>!row.complete))throw new Error('Analysez complètement les archives avant le transfert.');
    await this.prepare(signal);const client=this.client(signal),root=await this.bind(client,signal);let failures=0;
    for(const object of this.objects.values()){
      abort(signal);if(object.status==='verified')continue;
      this.log('Transfert : '+object.name);
      try{await this.transferOne(client,object,root,signal);}
      catch(error){abort(signal);await this.save({...this.objects.get(object.id),status:'error',error:error.message});if(error instanceof AuthError||error instanceof Retryable)throw error;failures++;this.log('Erreur : '+error.message);}
      this.notify();
    }
    if(failures)throw new Error(`${failures} fichier(s) restent en erreur. Consultez le journal puis reprenez.`);
  }
  async verify(signal,deep=false){
    await this.setting('cleanup-audit',null);
    if(!this.settings.binding||!this.objects.size)throw new Error('Aucun transfert à contrôler.');
    const client=this.client(signal);await this.bind(client,signal);let failures=0,index=0;
    for(const object of this.objects.values()){
      abort(signal);this.log(`Contrôle ${++index}/${this.objects.size} : ${object.name}`);
      try{
        if(object.fileid==null||!await client.matches(object,object.fileid,deep))throw new Error('Fichier absent ou empreintes incorrectes.');
        await this.verified(object,object.fileid);
      }catch(error){abort(signal);if(error instanceof AuthError||error instanceof Retryable)throw error;failures++;await this.save({...object,status:'error',error:error.message});}
      this.notify();
    }
    if(failures||[...this.archives.values()].some(row=>!row.complete))throw new Error('Le contrôle est incomplet. Consultez les fichiers en erreur et les parties manquantes.');
    abort(signal);
    if(deep)await this.setting('cleanup-audit',{completedAt:new Date().toISOString(),deep:true,
      inventory:inventoryFingerprint(this.objects,this.archives,this.settings.binding)});
  }
  snapshot(){
    let verified=0,errors=0,size=0,verifiedBytes=0;const errorRows=[];
    for(const object of this.objects.values()){
      size+=object.size;
      if(object.status==='verified'){verified++;verifiedBytes+=object.size;}
      if(object.status==='error'){errors++;if(errorRows.length<10)errorRows.push({name:object.name,error:object.error});}
    }
    return {settings:{paths:this.selected.map(file=>file.name),folder:this.settings.folder},
      database:{total:this.objects.size,verified,remaining:this.objects.size-verified,errors,bytes:size,verified_bytes:verifiedBytes,
        archives:[...this.archives.values()].map(row=>({...row,path:row.name})),binding:this.settings.binding||null,error_rows:errorRows},
      pcloud:{configured:Boolean(this.settings.client_id),connected:Boolean(this.identity&&this.auth),userid:this.identity?.userid,hostname:this.auth?.host},
      job:this.job,logs:this.logs,log_sequence:this.sequence,
      cleanup:cleanupState({objects:this.objects,archives:this.archives,binding:this.settings.binding,
        audit:this.settings['cleanup-audit'],identity:this.identity,auth:this.auth,busy:this.job.running})};
  }
}
