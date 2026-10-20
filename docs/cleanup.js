import {sha256,bytesToHex} from './vendor/archive.js';

export const AUDIT_LIFETIME=24*60*60*1000;
export function inventoryFingerprint(objects,archives,binding){
  const rows=[...objects.values()].map(object=>[object.id,object.sha1,object.size,object.folderid,object.fileid,object.status,object.checked]).sort((a,b)=>a[0].localeCompare(b[0]));
  const parts=[...archives.values()].map(archive=>[archive.id,archive.complete]).sort((a,b)=>a[0].localeCompare(b[0]));
  const target=binding?[binding.host,binding.userid,binding.folderid]:null;
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([rows,parts,target]))));
}

// This gate proves only a recent full readback of the supplied ZIP inventory.
// It must never be described as proof of the entire Google account's coverage.
export function cleanupState({objects,archives,binding,audit,identity,auth,busy},now=Date.now()){
  const fail=reason=>({ready:false,reason,archiveCount:archives.size});
  if(busy)return fail('Attendez la fin de l’opération en cours.');
  if(!objects.size||!archives.size)return fail('Analysez et transférez vos archives Takeout.');
  if([...archives.values()].some(archive=>!archive.complete))return fail('Terminez l’analyse de toutes les archives.');
  if([...objects.values()].some(object=>object.status!=='verified'))return fail('Tous les fichiers doivent être vérifiés, sans erreur ni fichier restant.');
  if(![...objects.values()].some(object=>object.category==='Medias'))return fail('L’inventaire ne contient aucun média reconnu. Vérifiez votre export Google Photos.');
  if(!binding||!identity||binding.userid!==identity.userid||binding.host!==auth?.host)return fail('Reconnectez le compte pCloud lié à ce journal.');
  const completed=Date.parse(audit?.completedAt);
  if(!audit?.deep||!Number.isFinite(completed)||completed>now||now-completed>AUDIT_LIFETIME)return fail('Lancez un contrôle intégral avant nettoyage ; sa validité est de 24 heures.');
  if(audit.inventory!==inventoryFingerprint(objects,archives,binding))return fail('L’inventaire a changé depuis le contrôle intégral. Relancez-le.');
  return {ready:true,reason:'Tous les fichiers fournis ont passé le contrôle intégral.',archiveCount:archives.size,completedAt:audit.completedAt,inventory:audit.inventory};
}

export function cleanupChecklist(state,{expectedParts,exportComplete,copiesReviewed,devicesReviewed,reportSaved,reportOffered}){
  if(!state.ready)return {ready:false,reason:state.reason};
  if(!Number.isSafeInteger(expectedParts)||expectedParts<1||expectedParts!==state.archiveCount)return {ready:false,reason:'Le nombre de parties doit correspondre au total annoncé par Google Takeout.'};
  if(!reportOffered||!reportSaved)return {ready:false,reason:'Téléchargez puis enregistrez le journal et le bilan avant de continuer.'};
  if(!exportComplete||!copiesReviewed||!devicesReviewed)return {ready:false,reason:'Confirmez le périmètre de l’export, vos copies et les appareils synchronisés.'};
  return {ready:true,reason:'Le guide est disponible. La suppression se confirme uniquement dans Google Photos.'};
}
