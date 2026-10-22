import {Retryable,MissingError,ConflictError,NotEmptyError,abort} from './browser-pcloud.js?v=5';

const normalized=name=>name.normalize('NFC').toLowerCase();
const encoder=new TextEncoder();
export function collisionName(name,digest){
  const dot=name.lastIndexOf('.'),extension=dot>0?name.slice(dot).slice(0,40):'';
  let stem=dot>0?name.slice(0,dot):name;
  const suffix=' ['+digest+']'+extension;
  while(encoder.encode(stem+suffix).length>1000)stem=Array.from(stem).slice(0,-1).join('');
  return stem+suffix;
}

// A new instance for each locked operation: never keep a stale remote index
// across reloads or retries. Listing each flat folder once avoids O(N²) listings.
export class FlatLayout{
  constructor(engine,client,root,signal){
    this.engine=engine;this.client=client;this.root=root;this.signal=signal;
    this.indices=new Map();this.reservations=new Map();
    for(const object of engine.objects.values())if(object.destination){
      this.reserve(object.destination,object.id);
    }
  }
  reserve(destination,id){
    if(!this.reservations.has(destination.folderid))this.reservations.set(destination.folderid,new Map());
    const reservations=this.reservations.get(destination.folderid),key=normalized(destination.name);
    if(reservations.has(key)&&reservations.get(key)!==id)throw new Error('Deux fichiers du journal réclament le même nom distant.');
    reservations.set(key,id);
  }
  async index(folderid,refresh=false){
    if(refresh||!this.indices.has(folderid)){
      const index=new Map();
      for(const file of await this.client.contents(folderid)){
        const key=normalized(file.name);if(!index.has(key))index.set(key,[]);index.get(key).push(file);
      }
      this.indices.set(folderid,index);
    }
    return this.indices.get(folderid);
  }
  async targetFolder(object){
    if(object.category==='Medias')return this.root;
    const key=object.category==='Metadonnees'?'metadata':'other',name=key==='metadata'?'Métadonnées Takeout':'Autres fichiers';
    if(!this.engine.settings.folders[key]){
      const folderid=await this.client.folder(this.root,name);
      await this.engine.setting('folders',{...this.engine.settings.folders,[key]:folderid});
    }
    return this.engine.settings.folders[key];
  }
  async destination(object){
    if(object.destination)return object.destination;
    const folderid=await this.targetFolder(object),index=await this.index(folderid);
    const original=object.original_name||object.name;
    const candidates=[original,collisionName(original,object.id)];
    let chosen;
    for(const name of candidates){
      const key=normalized(name),owner=this.reservations.get(folderid)?.get(key),files=index.get(key)||[];
      if(owner&&owner!==object.id)continue;
      // Reuse a received copy after restoring an older journal, but only after
      // verifying its bytes. Unrelated existing names are always preserved.
      if(files.length===1&&!files[0].isfolder&&files[0].size===object.size&&await this.client.matches(object,files[0].fileid)){chosen=files[0].name;break;}
    }
    if(!chosen)chosen=candidates.find(name=>!index.has(normalized(name))&&(!this.reservations.get(folderid)?.has(normalized(name))||this.reservations.get(folderid).get(normalized(name))===object.id));
    if(!chosen)throw new Error('Le nom original et son nom de secours sont déjà occupés. Aucun écrasement.');
    const destination={folderid,name:chosen};this.reserve(destination,object.id);
    await this.engine.save({...this.engine.objects.get(object.id),original_name:original,destination});
    return destination;
  }
  async received(object,destination){
    const files=(await this.index(destination.folderid)).get(normalized(destination.name))||[];
    if(!files.length)return null;
    if(files.length!==1||files[0].isfolder||!await this.client.matches(object,files[0].fileid))throw new Error('Le fichier de destination existe mais son contenu diffère. Aucun écrasement.');
    return files[0];
  }
  async publish(object){
    const destination=await this.destination(object);
    object=this.engine.objects.get(object.id);
    if(!object.publication&&object.fileid!=null){
      const publication={sourceid:object.fileid,sourcefolder:object.folderid};
      await this.engine.save({...object,publication,status:'organizing',error:null});
      object=this.engine.objects.get(object.id);
    }
    for(let attempt=0;attempt<6;attempt++){
      try{
        abort(this.signal);
        let target=await this.received(object,destination);
        if(!target){
          const sourceid=object.publication?.sourceid;
          if(sourceid==null)throw new Error('Aucune copie reçue à regrouper.');
          if(!await this.client.matches(object,sourceid))throw new Error('La copie source sur pCloud ne correspond pas à l’inventaire.');
          target=await this.client.copy(sourceid,destination.folderid,destination.name,object.captured);
          if(target.parentfolderid!==destination.folderid||target.name!==destination.name||!await this.client.matches(object,target.fileid))throw new Error('La copie regroupée n’a pas passé le contrôle. La source reste conservée.');
          // Rebuild once after the copy only if necessary on a retry. Normal
          // copies update the existing in-memory index without another listing.
        }
        const publication=object.publication;
        await this.engine.save({...this.engine.objects.get(object.id),fileid:target.fileid,folderid:destination.folderid,name:target.name,status:'organizing',error:null});
        if(publication&&publication.sourceid!==target.fileid){
          let source;
          try{source=await this.client.stat(publication.sourceid);}catch(error){if(!(error instanceof MissingError))throw error;}
          if(source){
            if(source.parentfolderid!==publication.sourcefolder||!await this.client.matches(object,publication.sourceid))throw new Error('La source a été déplacée ou modifiée pendant le regroupement. Elle reste conservée.');
            abort(this.signal);
            try{await this.client.call('deletefile',{fileid:publication.sourceid});}catch(error){if(!(error instanceof MissingError))throw error;}
          }
        }
        const index=await this.index(destination.folderid);
        index.set(normalized(target.name),[target]);
        await this.engine.save({...this.engine.objects.get(object.id),layout:'flat-v1',publication:null,status:'verified',error:null,checked:new Date().toISOString()});
        if(publication&&publication.sourcefolder!==destination.folderid)await this.removeStagingFolder(publication.sourcefolder,object.id);
        return;
      }catch(error){
        abort(this.signal);this.indices.delete(destination.folderid);
        if(error instanceof ConflictError){
          // copyfile(noover=1) may have committed before a lost receipt. Reconcile
          // the exact persisted name instead of creating another copy.
          if(attempt===5)throw error;continue;
        }
        if(!(error instanceof Retryable)||attempt===5)throw error;
        await this.client.retry(attempt,error);
      }
    }
  }
  async reuse(object){
    const destination=await this.destination(object);
    if(!await this.received(object,destination))return false;
    await this.publish(this.engine.objects.get(object.id));return true;
  }
  async removeStagingFolder(folderid,digest){
    try{
      const {metadata}=await this.client.call('listfolder',{folderid,nofiles:1});
      if(metadata.name!==digest)return;
      await this.client.call('deletefolder',{folderid});
    }catch(error){if(!(error instanceof MissingError||error instanceof NotEmptyError))throw error;}
  }
  async removeEmptyContainers(){
    const folders={...this.engine.settings.folders};
    for(const key of [...Object.keys(folders).filter(key=>/^[a-f0-9]{2}$/.test(key)),...(folders.files?['files']:[])]){
      const folderid=folders[key];delete folders[key];
      // Forget a disposable container before removing it. If the browser stops
      // after deletion, a future upload recreates it instead of using a dead ID.
      await this.engine.setting('folders',{...folders});
      try{await this.client.call('deletefolder',{folderid});}
      catch(error){
        if(error instanceof NotEmptyError){folders[key]=folderid;await this.engine.setting('folders',{...folders});}
        else if(!(error instanceof MissingError))throw error;
      }
    }
    await this.engine.setting('folders',folders);
  }
}
