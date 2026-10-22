// IndexedDB contains metadata only. API tokens are kept separately in sessionStorage.
export const DATABASE = 'passage-photos-browser-v1';
const stores = ['objects', 'sources', 'archives', 'settings', 'dates'];
const finished = transaction => new Promise((resolve,reject) => {
  transaction.oncomplete=resolve;
  transaction.onerror=()=>reject(transaction.error);
  transaction.onabort=()=>reject(transaction.error || new Error('Écriture du journal interrompue.'));
});
const result = request => new Promise((resolve,reject) => {
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
});

export async function openJournal(name=DATABASE) {
  const request=indexedDB.open(name,1);
  request.onupgradeneeded=()=>{
    const db=request.result;
    for(const name of stores) {
      const store=db.createObjectStore(name,{keyPath:'id'});
      if(name==='sources') {store.createIndex('digest','digest');store.createIndex('archive','archive');}
      if(name==='dates') store.createIndex('match','match');
    }
  };
  const db=await result(request);
  db.onversionchange=()=>db.close();
  return {
    db,
    async get(store,id){return result(db.transaction(store).objectStore(store).get(id));},
    async all(store,index,key){
      let source=db.transaction(store).objectStore(store);
      if(index) source=source.index(index);
      return result(source.getAll(key));
    },
    async put(store,value){const tx=db.transaction(store,'readwrite',{durability:'strict'});tx.objectStore(store).put(value);await finished(tx);},
    async entry(object,source,date){
      const tx=db.transaction(['objects','sources','dates'],'readwrite',{durability:'strict'});
      const objects=tx.objectStore('objects');
      const request=objects.get(object.id);
      request.onsuccess=()=>{if(!request.result) objects.put(object);};
      tx.objectStore('sources').put(source);
      if(date)tx.objectStore('dates').put(date);
      await finished(tx);
    },
    async backup(){
      const tx=db.transaction(stores);
      const data=await Promise.all(stores.map(name=>result(tx.objectStore(name).getAll())));
      return {format:'passage-photos-browser',version:1,exported:new Date().toISOString(),
        ...Object.fromEntries(stores.map((name,i)=>[name,data[i]]))};
    },
    async restore(data){
      validateBackup(data);
      // Imports never trust past verification blindly. Remote reconciliation
      // verifies every object again, without needing its ZIP if already received.
      const tx=db.transaction(stores,'readwrite',{durability:'strict'});
      for(const name of stores){
        const store=tx.objectStore(name);store.clear();
        for(const row of data[name]){
          if(name==='settings'&&row.id==='cleanup-audit')continue;
          store.put(name==='objects'?{...row,status:'pending',error:null}:row);
        }
      }
      await finished(tx);
    }
  };
}

export function validateBackup(data){
  if(data?.format!=='passage-photos-browser'||data.version!==1||stores.some(name=>!Array.isArray(data[name])))throw new Error('Ce fichier n’est pas un journal Passage Photos compatible.');
  const hex=/^[a-f0-9]{64}$/;
  const ids=new Set();
  for(const row of data.objects){
    if(!hex.test(row.id)||row.sha256!==row.id||!/^[a-f0-9]{40}$/.test(row.sha1)||!Number.isSafeInteger(row.size)||row.size<0||typeof row.name!=='string'||/[\0/\\]/.test(row.name)||ids.has(row.id))throw new Error('Le journal contient un fichier invalide.');
    for(const field of ['fileid','folderid'])if(row[field]!=null&&(!Number.isSafeInteger(row[field])||row[field]<0))throw new Error('Identifiant pCloud invalide dans le journal.');
    if(row.destination&&(!Number.isSafeInteger(row.destination.folderid)||row.destination.folderid<0||typeof row.destination.name!=='string'||/[\0/\\]/.test(row.destination.name)))throw new Error('Destination de regroupement invalide.');
    if(row.publication&&['sourceid','sourcefolder'].some(field=>!Number.isSafeInteger(row.publication[field])||row.publication[field]<0))throw new Error('État de regroupement invalide.');
    ids.add(row.id);
  }
  const archives=new Set(data.archives.map(row=>row.id));
  if(data.archives.some(row=>!hex.test(row.id)||typeof row.name!=='string'))throw new Error('Archive invalide dans le journal.');
  if(data.sources.some(row=>!ids.has(row.digest)||!archives.has(row.archive)||!Number.isSafeInteger(row.ordinal)||row.ordinal<0||typeof row.path!=='string'))throw new Error('Provenance invalide dans le journal.');
  if(data.settings.some(row=>!['binding','folder','client_id','folders','cleanup-audit'].includes(row.id)))throw new Error('Paramètre inattendu dans le journal.');
  const binding=data.settings.find(row=>row.id==='binding')?.value;
  if(binding&&(!['api.pcloud.com','eapi.pcloud.com'].includes(binding.host)||!Number.isSafeInteger(binding.folderid)||!Number.isSafeInteger(binding.userid)))throw new Error('Destination invalide dans le journal.');
}
