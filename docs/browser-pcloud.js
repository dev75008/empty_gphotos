import {sha256,bytesToHex} from './vendor/archive.js';
import {HOSTS} from './browser-auth.js';
export class Retryable extends Error{constructor(message,delay=0){super(message);this.delay=delay;}}
export class AuthError extends Error{}
export function abort(signal){signal?.throwIfAborted();}
export function wait(ms,signal){return new Promise((resolve,reject)=>{
  abort(signal);
  const onAbort=()=>{clearTimeout(timer);reject(signal.reason);};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve();},ms);
  signal?.addEventListener('abort',onAbort,{once:true});
});}
export class BrowserPCloud{
  constructor(auth,signal,notify=()=>{}){
    if(!auth||!HOSTS.includes(auth.host))throw new AuthError('Connectez votre compte pCloud.');
    this.auth=auth;this.signal=signal;this.notify=notify;
  }
  async request(method,fields,upload=false){
    abort(this.signal);
    const body=upload?fields:new URLSearchParams({...fields,access_token:this.auth.token});
    if(upload)body.set('access_token',this.auth.token);
    const uploadSize=upload?fields.get('file')?.size||0:0;
    const timeout=AbortSignal.timeout(upload?Math.ceil(Math.min(2147483647,Math.max(3600000,uploadSize/16384*1000+120000))):120000);
    // AbortSignal.any is supported in current Chrome/Edge/Firefox/Safari.
    const signal=this.signal?AbortSignal.any([this.signal,timeout]):timeout;
    let response;
    try{response=await fetch(`https://${this.auth.host}/${method}`,{method:'POST',body,signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});}
    catch(error){abort(this.signal);throw new Retryable('Connexion pCloud interrompue, bloquée par le navigateur ou délai dépassé.');}
    if([401,403].includes(response.status))throw new AuthError('Accès pCloud refusé. Reconnectez votre compte.');
    if(response.status===429||response.status>=500){
      const retry=response.headers.get('Retry-After');
      const delay=Number(retry)*1000||Math.max(0,Date.parse(retry)-Date.now())||0;
      throw new Retryable(`pCloud temporairement indisponible (HTTP ${response.status}).`,Math.min(delay,3600000));
    }
    if(!response.ok)throw new Error(`pCloud a répondu HTTP ${response.status}.`);
    let data;try{data=await response.json();}catch{throw new Retryable('Réponse pCloud incomplète.');}
    if([1000,2000,2094].includes(data.result))throw new AuthError('Jeton pCloud refusé. Reconnectez votre compte pour reprendre.');
    if([2041,4000,5000,5001].includes(data.result))throw new Retryable(`Erreur pCloud temporaire (${data.result}).`);
    if(data.result!==0)throw new Error({2008:'Espace pCloud insuffisant.',2003:'Accès au dossier pCloud refusé.',2005:'Dossier pCloud absent.',2009:'Fichier pCloud absent.'}[data.result]||`Erreur pCloud ${data.result??'inconnue'} (${method}).`);
    return data;
  }
  async call(method,fields={}){
    for(let attempt=0;attempt<6;attempt++){
      try{return await this.request(method,fields);}
      catch(error){if(!(error instanceof Retryable)||attempt===5)throw error;await this.retry(attempt,error);}
    }
  }
  async retry(attempt,error){const delay=Math.max(Math.min(60000,2000*2**attempt+Math.random()*1000),error.delay||0);this.notify(`Nouvel essai dans ${Math.ceil(delay/1000)} s. ${error.message}`);await wait(delay,this.signal);}
  async folder(parent,name){return (await this.call('createfolderifnotexists',{folderid:parent,name})).metadata.folderid;}
  async contents(folderid){return (await this.call('listfolder',{folderid})).metadata.contents||[];}
  async upload(object,blob,folderid){
    const body=new FormData();
    // Parameters precede the file, as required by pCloud's multipart API.
    body.append('access_token',this.auth.token);body.append('folderid',String(folderid));body.append('nopartial','1');
    if(object.captured!=null){body.append('mtime',String(object.captured));body.append('ctime',String(object.captured));}
    body.append('file',blob,object.name);
    const data=await this.request('uploadfile',body,true);
    if(data.metadata?.length!==1)throw new Retryable('Réponse d’envoi perdue ou ambiguë.');
    return data.metadata[0].fileid;
  }
  async matches(object,fileid,deep=false){
    const data=await this.call('checksumfile',{fileid});
    if(data.metadata.size!==object.size||data.sha1?.toLowerCase()!==object.sha1)return false;
    if(data.sha256&&data.sha256.toLowerCase()!==object.sha256)return false;
    if(deep||!data.sha256)return (await this.downloadHash(fileid))===object.sha256;
    return true;
  }
  async downloadHash(fileid){
    for(let attempt=0;attempt<6;attempt++){
      try{
        const link=await this.call('getfilelink',{fileid}),host=link.hosts?.[0];
        if(!host?.endsWith('.pcloud.com')||new URL('https://'+host).hostname!==host||!link.path?.startsWith('/')||link.path.startsWith('//'))throw new Error('Lien pCloud inattendu.');
        const signal=this.signal?AbortSignal.any([this.signal,AbortSignal.timeout(3600000)]):AbortSignal.timeout(3600000);
        const response=await fetch('https://'+host+link.path,{signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
        if(!response.ok)throw new Retryable(`Relecture pCloud HTTP ${response.status}.`);
        const hash=sha256.create(),reader=response.body.getReader();let count=0;
        try{while(true){abort(this.signal);const {value,done}=await reader.read();if(done)break;hash.update(value);count+=value.byteLength;this.notify(`Vérification distante : ${count.toLocaleString('fr-FR')} octets`);}}
        finally{await reader.cancel().catch(()=>{});}
        return bytesToHex(hash.digest());
      }catch(error){abort(this.signal);if(error instanceof TypeError)error=new Retryable('Relecture distante impossible (réseau ou règle CORS pCloud).');if(!(error instanceof Retryable)||attempt===5)throw error;await this.retry(attempt,error);}
    }
  }
}
