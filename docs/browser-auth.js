export const HOSTS=['api.pcloud.com','eapi.pcloud.com'];
export const redirectURI=()=>new URL('./',location.href).href;
const key='passage-pcloud-auth-v1';
export function sessionAuth(){
  try{
    const auth=JSON.parse(sessionStorage.getItem(key)||'null');
    return auth&&HOSTS.includes(auth.host)&&typeof auth.token==='string'?auth:null;
  }catch{return null;}
}
export function clearAuth(){sessionStorage.removeItem(key);}
export function beginAuth(clientId){
  if(!clientId?.trim())throw new Error('Renseignez le Client ID de votre application pCloud.');
  const state=crypto.randomUUID()+crypto.randomUUID();
  sessionStorage.setItem('passage-oauth-state',JSON.stringify({state,time:Date.now()}));
  const parameters=new URLSearchParams({client_id:clientId.trim(),response_type:'token',redirect_uri:redirectURI(),state});
  location.assign('https://my.pcloud.com/oauth2/authorize?'+parameters);
}
export function consumeCallback(){
  const params=new URLSearchParams(location.hash.slice(1));
  if(!params.has('access_token')&&!params.has('error'))return sessionAuth();
  // A URL fragment never reaches the hosting server; remove it before rendering.
  history.replaceState(null,'',location.pathname+location.search);
  let expected;
  try{expected=JSON.parse(sessionStorage.getItem('passage-oauth-state'));}catch{}
  sessionStorage.removeItem('passage-oauth-state');
  if(!expected||params.get('state')!==expected.state||Date.now()-expected.time>15*60*1000)throw new Error('Retour OAuth invalide ou expiré. Reconnectez pCloud depuis cette page.');
  if(params.has('error'))throw new Error('Autorisation pCloud refusée. Vous pouvez réessayer.');
  const host=params.get('hostname'),token=params.get('access_token');
  if(!HOSTS.includes(host)||!token||params.get('token_type')!=='bearer')throw new Error('Réponse OAuth pCloud inattendue.');
  const auth={host,token};sessionStorage.setItem(key,JSON.stringify(auth));return auth;
}
