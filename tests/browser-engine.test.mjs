import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {ZipWriter,BlobWriter,TextReader} from '@zip.js/zip.js';
import {openJournal,validateBackup} from '../docs/browser-state.js';
import {BrowserMigration} from '../docs/browser-engine.js';
import {sha256,bytesToHex} from '../docs/vendor/archive.js';
import {BrowserPCloud,Retryable,AuthError} from '../docs/browser-pcloud.js';
import {consumeCallback,sessionAuth} from '../docs/browser-auth.js';
import {cleanupChecklist,AUDIT_LIFETIME} from '../docs/cleanup.js';

async function zip(entries,name='takeout.zip',options={}){
  const writer=new ZipWriter(new BlobWriter(),{useWebWorkers:false});
  for(const [path,payload] of Object.entries(entries))await writer.add(path,new TextReader(payload),options);
  return new File([await writer.close()],name);
}
class Cloud{
  constructor(){this.files=new Map();this.folders=new Map();this.next=1;this.uploads=0;this.lost=false;this.stop=null;this.userid=12;}
  async call(method){if(method==='userinfo')return{userid:this.userid};if(method==='listfolder')return{metadata:{}};throw new Error(method);}
  async folder(parent,name){const key=parent+'/'+name;if(!this.folders.has(key))this.folders.set(key,this.next++);return this.folders.get(key);}
  async contents(folderid){return [...this.files.values()].filter(file=>file.folderid===folderid);}
  async upload(object,blob,folderid){
    this.uploads++;const fileid=this.next++;
    this.files.set(fileid,{fileid,folderid,name:object.name,payload:new Uint8Array(await blob.arrayBuffer())});
    if(this.stop){this.stop.abort(new DOMException('Pause','AbortError'));this.stop=null;throw new Error('Réponse interrompue.');}
    if(this.lost){this.lost=false;throw new Retryable('Réponse perdue.');}return fileid;
  }
  async matches(object,fileid){const remote=this.files.get(fileid);return Boolean(remote&&bytesToHex(sha256(remote.payload))===object.sha256);}
  async retry(){}
}
async function setup(){
  const journal=await openJournal('test-'+crypto.randomUUID()),cloud=new Cloud();
  const engine=new BrowserMigration(journal);await engine.load();
  engine.auth={host:'eapi.pcloud.com',token:'dummy'};engine.client=()=>cloud;
  return{journal,cloud,engine,signal:new AbortController().signal};
}

test('Cleanup requires fresh full verification and every manual confirmation; restore invalidates it',async()=>{
  const {engine,journal,signal,cloud}=await setup();
  await engine.select([await zip({'photo.jpg':'photo'})]);await engine.scan(signal);await engine.run(signal);
  assert.equal(engine.snapshot().cleanup.ready,false);
  await engine.verify(signal);assert.equal(engine.snapshot().cleanup.ready,false);
  await engine.verify(signal,true);const state=engine.snapshot().cleanup;assert.equal(state.ready,true);
  const confirmations={expectedParts:1,exportComplete:true,copiesReviewed:true,devicesReviewed:true,reportSaved:true,reportOffered:true};
  assert.equal(cleanupChecklist(state,confirmations).ready,true);
  for(const field of ['exportComplete','copiesReviewed','devicesReviewed','reportSaved','reportOffered'])assert.equal(cleanupChecklist(state,{...confirmations,[field]:false}).ready,false);
  assert.equal(cleanupChecklist(state,{...confirmations,expectedParts:2}).ready,false);
  engine.settings['cleanup-audit'].completedAt=new Date(Date.now()-AUDIT_LIFETIME-1000).toISOString();
  assert.equal(engine.snapshot().cleanup.ready,false);
  await engine.verify(signal,true);
  const backup=await journal.backup();await journal.restore(backup);await engine.load();
  assert.equal(engine.settings['cleanup-audit'],undefined);assert.equal(engine.snapshot().cleanup.ready,false);
  await engine.run(signal);await engine.verify(signal,true);
  [...cloud.files.values()][0].payload=new TextEncoder().encode('corrupted');
  await assert.rejects(engine.verify(signal,true));assert.equal(engine.snapshot().cleanup.ready,false);
  journal.db.close();
});

test('Browser engine hashes ZIPs, deduplicates albums, keeps homonyms and dates',async()=>{
  const {journal,cloud,engine,signal}=await setup();
  await engine.select([await zip({'2020/été.jpg':'photo','album/été.jpg':'photo','2021/été.jpg':'other','2020/été.jpg.supplemental-metadata.json':JSON.stringify({title:'été.jpg',photoTakenTime:{timestamp:'1580000000'}})})]);
  await engine.scan(signal);
  assert.equal(engine.objects.size,3);assert.equal((await journal.all('sources')).length,4);
  assert.equal([...engine.objects.values()].find(row=>row.captured)?.captured,1580000000);
  await engine.run(signal);assert.equal(cloud.uploads,3);assert.equal(engine.snapshot().database.verified,3);
  await engine.run(signal);assert.equal(cloud.uploads,3);
  await engine.verify(signal,true);
  assert.equal([...cloud.files.values()].filter(file=>file.name==='été.jpg').length,2);
  journal.db.close();
});

test('Lost receipt is reconciled without a second browser upload',async()=>{
  const {engine,cloud,signal,journal}=await setup();
  await engine.select([await zip({'photo.jpg':'photo'})]);await engine.scan(signal);cloud.lost=true;
  await engine.run(signal);assert.equal(cloud.uploads,1);assert.equal(engine.snapshot().database.verified,1);journal.db.close();
});

test('Closed or paused browser resumes from IndexedDB without the source after remote commit',async()=>{
  const {engine,cloud,journal,signal}=await setup();
  await engine.select([await zip({'photo.jpg':'photo'})]);await engine.scan(signal);
  const controller=new AbortController();cloud.stop=controller;
  await assert.rejects(engine.run(controller.signal));
  const resumed=new BrowserMigration(journal);await resumed.load();resumed.auth=engine.auth;resumed.client=()=>cloud;
  assert.equal([...resumed.objects.values()][0].status,'uploading');
  await resumed.run(signal);assert.equal(cloud.uploads,1);assert.equal(resumed.snapshot().database.verified,1);journal.db.close();
});

test('Remote corruption is detected and never overwritten',async()=>{
  const {engine,cloud,journal,signal}=await setup();
  await engine.select([await zip({'photo.jpg':'photo'})]);await engine.scan(signal);await engine.run(signal);
  [...cloud.files.values()][0].payload=new TextEncoder().encode('bad');
  await assert.rejects(engine.verify(signal));await assert.rejects(engine.run(signal));
  assert.equal(cloud.uploads,1);assert.equal(engine.snapshot().database.errors,1);journal.db.close();
});

test('Journal backup excludes secrets and import rechecks previously verified content',async()=>{
  const {engine,cloud,journal,signal}=await setup();
  await engine.select([await zip({'photo.jpg':'photo'})]);await engine.scan(signal);await engine.run(signal);
  const backup=await journal.backup();validateBackup(backup);assert.equal(JSON.stringify(backup).includes('dummy'),false);
  await journal.restore(backup);await engine.load();assert.equal(engine.snapshot().database.verified,0);
  await engine.run(signal);assert.equal(cloud.uploads,1);
  backup.objects[0].size=-1;assert.throws(()=>validateBackup(backup));journal.db.close();
});

test('CRC corruption leaves an incomplete archive and blocks browser transfer',async()=>{
  const {engine,journal,signal}=await setup();
  const file=await zip({'photo.jpg':'unique-original-payload'},'bad.zip',{level:0});
  const buffer=new Uint8Array(await file.arrayBuffer()),needle=new TextEncoder().encode('unique-original-payload');
  let changed=false;
  for(let i=0;i<buffer.length-needle.length;i++)if(needle.every((byte,index)=>buffer[i+index]===byte)){buffer[i]^=1;changed=true;break;}
  assert.equal(changed,true);await engine.select([new File([buffer],'bad.zip')]);
  await assert.rejects(engine.scan(signal));assert.equal([...engine.archives.values()][0].complete,false);
  await assert.rejects(engine.run(signal));journal.db.close();
});

test('Account binding rejects another pCloud user',async()=>{
  const {engine,cloud,journal,signal}=await setup();
  await engine.select([await zip({'photo.jpg':'photo'})]);await engine.scan(signal);await engine.run(signal);
  cloud.userid=99;await assert.rejects(engine.identify(signal),AuthError);journal.db.close();
});

test('Browser API uses POST body, rejects invalid tokens and checks EU SHA-256',async()=>{
  const original=globalThis.fetch;
  try{
    let calls=0;
    globalThis.fetch=async(url,options)=>{
      calls++;assert.equal(new URL(url).search,'');assert.equal(options.body.get('access_token'),'secret');
      return Response.json({result:2094});
    };
    const client=new BrowserPCloud({host:'eapi.pcloud.com',token:'secret'});
    await assert.rejects(client.call('userinfo'),AuthError);assert.equal(calls,1);
    globalThis.fetch=async()=>Response.json({result:0,metadata:{size:3},sha1:'one',sha256:'two'});
    assert.equal(await client.matches({size:3,sha1:'one',sha256:'two'},12),true);
    assert.equal(await client.matches({size:3,sha1:'one',sha256:'wrong'},12),false);
  }finally{globalThis.fetch=original;}
});

test('OAuth rejects forged state and untrusted hosts before storing a token',()=>{
  const old={location:globalThis.location,history:globalThis.history,sessionStorage:globalThis.sessionStorage};
  const values=new Map();
  globalThis.sessionStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  globalThis.location={hash:'#access_token=secret&hostname=eapi.pcloud.com&token_type=bearer&state=forged',pathname:'/',search:''};
  globalThis.history={replaceState(){globalThis.location.hash='';}};
  try{
    values.set('passage-oauth-state',JSON.stringify({state:'expected',time:Date.now()}));
    assert.throws(()=>consumeCallback(),/invalide/);assert.equal(sessionAuth(),null);assert.equal(globalThis.location.hash,'');
    globalThis.location.hash='#access_token=secret&hostname=evil.example&token_type=bearer&state=expected';
    values.set('passage-oauth-state',JSON.stringify({state:'expected',time:Date.now()}));
    assert.throws(()=>consumeCallback(),/inattendue/);assert.equal(sessionAuth(),null);
  }finally{for(const [key,value] of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('US verification streams a signed download without forwarding the API token',async()=>{
  const original=globalThis.fetch,abc=new TextEncoder().encode('abc');
  try{
    const client=new BrowserPCloud({host:'api.pcloud.com',token:'secret'});
    client.call=async(method)=>method==='checksumfile'?{metadata:{size:3},sha1:'one'}:{hosts:['c123.pcloud.com'],path:'/signed-file'};
    globalThis.fetch=async(url,options)=>{
      assert.equal(url,'https://c123.pcloud.com/signed-file');assert.equal(options.credentials,'omit');assert.equal(options.headers,undefined);
      return new Response(new ReadableStream({start(controller){controller.enqueue(abc.slice(0,1));controller.enqueue(abc.slice(1));controller.close();}}));
    };
    assert.equal(await client.matches({size:3,sha1:'one',sha256:bytesToHex(sha256(abc))},12),true);
  }finally{globalThis.fetch=original;}
});
