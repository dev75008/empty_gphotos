// A local consistency check, not a Google certificate or a fresh pCloud check.
export async function validateProof(data,now=Date.now()){
  const fail=()=>{throw new Error('Dossier de contrôle invalide ou incomplet. Refaites le contrôle intégral sur Passage Photos.');};
  if(data?.format!=='passage-photos-browser'||data.version!==1||!Array.isArray(data.objects)||!Array.isArray(data.archives)||!Array.isArray(data.settings))fail();
  const audit=data.cleanup_review?.audit,summary=data.cleanup_review?.summary;
  const completed=Date.parse(audit?.completedAt);
  if(!audit?.deep||!Number.isFinite(completed)||completed>now||now-completed>86400000)throw new Error('Contrôle absent ou expiré (24 heures). Relancez le contrôle intégral sur le site.');
  const objects=data.objects,archives=data.archives;
  if(!objects.length||!archives.length||new Set(objects.map(o=>o.id)).size!==objects.length||new Set(archives.map(a=>a.id)).size!==archives.length)fail();
  if(objects.some(o=>!/^[a-f0-9]{64}$/.test(o.id)||o.id!==o.sha256||!/^[a-f0-9]{40}$/.test(o.sha1)||!Number.isSafeInteger(o.size)||o.size<0||o.status!=='verified'||!Number.isSafeInteger(o.fileid)||!Number.isSafeInteger(o.folderid)))fail();
  if(!objects.some(o=>o.category==='Medias')||archives.some(a=>!a.complete||!/^[a-f0-9]{64}$/.test(a.id)))fail();
  if(summary?.total!==objects.length||summary.verified!==objects.length||summary.remaining!==0||summary.errors!==0||summary.archives?.length!==archives.length||summary.archives.some(a=>!a.complete||a.unverified_entries!==0))fail();
  const binding=data.settings.find(s=>s.id==='binding')?.value;
  if(!binding||!['api.pcloud.com','eapi.pcloud.com'].includes(binding.host)||!Number.isSafeInteger(binding.userid)||!Number.isSafeInteger(binding.folderid))fail();
  const rows=objects.map(o=>[o.id,o.sha1,o.size,o.folderid,o.fileid,o.status,o.checked]).sort((a,b)=>a[0].localeCompare(b[0]));
  const parts=archives.map(a=>[a.id,a.complete]).sort((a,b)=>a[0].localeCompare(b[0]));
  const bytes=new TextEncoder().encode(JSON.stringify([rows,parts,[binding.host,binding.userid,binding.folderid]]));
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(audit.inventory!==fingerprint)fail();
  return {completedAt:audit.completedAt,expiresAt:completed+86400000,inventory:fingerprint,files:objects.length,parts:archives.length};
}
