import {emptyStatus,progressOf,bytes,jobLabel,readiness} from './model.js';
import {openJournal} from './browser-state.js?v=3';
import {BrowserMigration} from './browser-engine.js?v=3';
import {beginAuth,consumeCallback,redirectURI} from './browser-auth.js';
import {cleanupChecklist} from './cleanup.js';

const $=id=>document.getElementById(id);
const format=value=>new Intl.NumberFormat('fr-FR').format(value);
const plural=(value,noun)=>`${format(value)} ${noun}${value===1?'':'s'}`;
let engine,status=emptyStatus(),supported=false,pending=false,folderDirty=false,detail='',renderTimer;
let cleanupReportKey='',cleanupCurrentKey='';
const auditKey=state=>state?.ready?state.completedAt+'|'+state.inventory:'';
function checklist(){
  const technical=engine?.snapshot().cleanup||{ready:false,reason:'Analysez et transférez vos archives Takeout.'};
  const expected=$('cleanup-parts').value.trim();
  return cleanupChecklist(technical,{expectedParts:expected?Number(expected):0,
    exportComplete:$('cleanup-export').checked,copiesReviewed:$('cleanup-copies').checked,
    devicesReviewed:$('cleanup-devices').checked,reportSaved:$('cleanup-saved').checked,
    reportOffered:Boolean(cleanupReportKey)&&cleanupReportKey===auditKey(technical)});
}
function renderCleanup(){
  const technical=status.cleanup||{ready:false,reason:'Analysez et transférez vos archives Takeout.'};
  const key=auditKey(technical),busy=status.job.running||pending;
  if(cleanupCurrentKey!==key){
    for(const id of ['cleanup-export','cleanup-copies','cleanup-devices','cleanup-saved'])$(id).checked=false;
    cleanupReportKey='';cleanupCurrentKey=key;
    $('cleanup-dialog').close();
  }
  $('cleanup-status').textContent=technical.ready?'Contrôle intégral réussi':'Contrôle requis';
  $('cleanup-hint').textContent=technical.ready?`${technical.archiveCount} partie(s) inventoriée(s). Contrôle intégral du ${new Date(technical.completedAt).toLocaleString('fr-FR')}.`:technical.reason;
  $('cleanup-audit-button').disabled=!supported||busy||!status.pcloud.connected||!status.database.binding||!status.database.total||status.database.remaining>0||status.database.archives.some(row=>!row.complete);
  $('cleanup-report-button').disabled=!technical.ready||busy;
  $('cleanup-fields').disabled=!technical.ready||busy;
  const decision=engine?checklist():{ready:false,reason:technical.reason};
  $('cleanup-guide-button').disabled=!decision.ready||busy;
  $('cleanup-checklist-hint').textContent=decision.reason;
}
function message(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);$('notice').hidden=!text;}
function changed(event){
  if(event?.detail)detail=event.detail;
  if(!renderTimer)renderTimer=setTimeout(()=>{renderTimer=null;if(engine)status=engine.snapshot();render();},250);
}
function render(){
  const {database:db,pcloud,job,settings}=status;
  const ready=readiness(status,supported),busy=job.running||pending;
  $('connection-badge').textContent=supported?'Journal prêt dans ce navigateur':'Ouverture du journal';
  $('connection-badge').classList.toggle('connected',supported);
  $('pcloud-state').textContent=pcloud.connected?'Connecté':pcloud.configured?'À connecter':'À préparer';
  $('pcloud-state').classList.toggle('done',pcloud.connected);
  $('pcloud-description').textContent=pcloud.connected?`Compte pCloud ${pcloud.userid} · ${pcloud.hostname==='eapi.pcloud.com'?'Europe':'États-Unis'}`:'Le compte qui recevra vos photos et vidéos.';
  $('auth-button').textContent=pcloud.connected?'Reconnecter pCloud':'Connecter mon compte pCloud';
  $('auth-button').disabled=!ready.auth||pending;
  $('credentials-fields').disabled=!ready.edit||pending;
  $('pick-button').disabled=!ready.edit||pending;$('zip-files').disabled=!ready.edit||pending;
  $('scan-button').disabled=!ready.scan||pending;
  $('folder').disabled=!ready.edit||Boolean(db.binding)||pending;
  if(db.binding||(!folderDirty&&document.activeElement!==$('folder')))$('folder').value=db.binding?.initial_name||settings.folder;
  $('folder-help').textContent=db.binding?'Destination liée au journal. Vous pouvez renommer ce dossier directement dans pCloud.':'Vous pourrez le renommer dans pCloud après sa création.';
  $('selection-label').textContent=settings.paths.length===1?settings.paths[0]:settings.paths.length?`${plural(settings.paths.length,'archive')} sélectionnées`:'Aucune archive sélectionnée';
  $('selection-detail').textContent=settings.paths.length?'Les ZIP restent sur votre ordinateur.':'Vous pouvez ajouter les parties une par une.';
  $('archive-state').textContent=!db.archives.length?'À préparer':db.archives.some(a=>!a.complete)?'Analyse incomplète':`${plural(db.archives.length,'partie')} ${db.archives.length===1?'analysée':'analysées'}`;
  $('archive-state').classList.toggle('done',db.archives.length>0&&db.archives.every(a=>a.complete));
  $('run-button').disabled=!ready.run||pending;
  $('run-button').textContent=db.total&&db.remaining===0?'Tous les fichiers sont vérifiés':db.verified||job.paused||db.errors?'Reprendre le transfert':'Lancer le transfert';
  $('run-hint').textContent=!supported?'Le stockage du navigateur est requis.':busy?'Une opération est en cours.':!pcloud.connected?'Connectez votre compte pCloud.':!db.total?'Analysez vos archives pour continuer.':db.archives.some(a=>!a.complete)?'Terminez l’analyse des archives.':!db.remaining?'Lancez le contrôle final.':'Les fichiers déjà vérifiés sont conservés.';
  $('job-state').textContent=jobLabel(job);
  const percent=progressOf(db);$('progress').value=percent;$('percent').textContent=`${percent} %`;
  $('progress-caption').textContent=db.total?`${plural(db.total,'fichier')} ${db.total===1?'unique':'uniques'}`:'Aucun fichier analysé';
  for(const field of ['verified','remaining','errors'])$('count-'+field).textContent=format(db[field]);
  $('count-errors').classList.toggle('has-errors',db.errors>0);
  $('volume').textContent=db.bytes?`${bytes(db.verified_bytes)} / ${bytes(db.bytes)}`:'0 octet';
  $('activity').textContent=job.running?{auth:'Vérification de la connexion pCloud.',scan:'Lecture des ZIP et contrôle des empreintes.',run:'Envoi et vérification des fichiers sur pCloud.',verify:'Contrôle des fichiers reçus sur pCloud.',restore:'Restauration du journal.'}[job.command]||'Opération en cours.':job.paused?'Opération en pause. Le journal est conservé.':job.exit_code?'L’opération s’est arrêtée. Consultez le journal puis reprenez.':job.command==='verify'&&job.exit_code===0?'Contrôle terminé. Comparez aussi les parties traitées avec votre export Google.':db.total&&!db.remaining?'Tous les fichiers inventoriés sont vérifiés. Pensez au contrôle final.':db.total?(pcloud.connected?'Votre inventaire est prêt. Lancez ou reprenez le transfert.':'Votre inventaire est prêt. Connectez pCloud pour continuer.'):'Connectez pCloud et choisissez vos archives pour commencer.';
  $('live-detail').textContent=job.running?detail:'';$('live-detail').hidden=!job.running||!detail;
  $('pause-button').hidden=!job.running;$('pause-button').disabled=job.paused;
  $('pause-button').textContent=job.command==='scan'?'Interrompre l’analyse':'Mettre en pause';
  $('verify-button').disabled=!ready.verify||pending;$('deep').disabled=!ready.verify||pending;
  $('manifest-button').disabled=!ready.report||pending;$('summary-button').disabled=!ready.report||pending;
  $('backup-button').disabled=!supported||busy;$('restore-button').disabled=!supported||busy;
  $('persist-button').disabled=!supported||busy;
  $('logs').textContent=status.logs.join('\n')||'Les opérations apparaîtront ici.';
  $('archives-section').hidden=!db.archives.length;$('archives-count').textContent=plural(db.archives.length,'partie');
  $('archive-list').replaceChildren(...db.archives.map(archive=>{
    const row=document.createElement('div');row.className='archive-row';
    const name=document.createElement('span');name.textContent=archive.path;
    const state=document.createElement('span');state.className='small';state.textContent=archive.complete?'Analyse complète':'Analyse incomplète';
    row.append(name,state);return row;
  }));
  $('errors-section').hidden=!db.error_rows.length;
  $('error-list').replaceChildren(...db.error_rows.map(error=>{const li=document.createElement('li');li.textContent=`${error.name} : ${error.error}`;return li;}));
  renderCleanup();
}
async function act(operation){
  if(pending)return;pending=true;message('');render();
  try{await operation();}catch(error){message(error.message||'L’opération a échoué.',true);}
  finally{pending=false;if(engine)status=engine.snapshot();render();}
}
function start(command,operation){return act(()=>engine.task(command,operation));}
function download(data,name,type='application/json'){
  const href=URL.createObjectURL(new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type}));
  const link=document.createElement('a');link.href=href;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
}
async function summary(){
  const sources=await engine.journal.all('sources');
  return {format:'passage-photos-bilan',created:new Date().toISOString(),...engine.snapshot().database,
    archives:[...engine.archives.values()].map(archive=>({...archive,unverified_entries:sources.filter(source=>source.archive===archive.id&&engine.objects.get(source.digest)?.status!=='verified').length})),
    source_entries:sources.length,scope:'Fichiers des ZIP fournis uniquement. Comparez la liste des parties avec Google Takeout.'};
}
$('credentials-form').addEventListener('submit',event=>{event.preventDefault();act(async()=>{
  const id=$('client-id').value.trim();if(!id)throw new Error('Saisissez votre Client ID pCloud.');
  await engine.setting('client_id',id);$('credentials-details').open=false;
  message('Client ID enregistré. Cliquez sur Connecter mon compte pCloud.');
});});
$('auth-button').addEventListener('click',()=>{try{beginAuth(engine.settings.client_id);}catch(error){message(error.message,true);}});
$('pick-button').addEventListener('click',()=>$('zip-files').click());
$('zip-files').addEventListener('change',()=>act(()=>engine.select($('zip-files').files)));
$('scan-button').addEventListener('click',()=>start('scan',signal=>engine.scan(signal)));
$('folder').addEventListener('input',()=>{folderDirty=true;});
$('run-button').addEventListener('click',()=>start('run',async signal=>{
  if(!engine.settings.binding)await engine.setting('folder',$('folder').value);folderDirty=false;
  await engine.run(signal);
}));
$('pause-button').addEventListener('click',()=>engine.pause());
$('verify-button').addEventListener('click',()=>start('verify',signal=>engine.verify(signal,$('deep').checked)));
$('cleanup-audit-button').addEventListener('click',()=>start('verify',signal=>engine.verify(signal,true)));
$('cleanup-report-button').addEventListener('click',()=>act(async()=>{
  const technical=engine.snapshot().cleanup;
  if(!technical.ready)throw new Error(technical.reason);
  const journal=await engine.journal.backup();
  journal.cleanup_review={audit:engine.settings['cleanup-audit'],summary:await summary(),
    scope:'Contrôle des ZIP fournis uniquement. Aucune preuve de couverture de tout le compte Google.'};
  download(journal,'passage-photos-avant-nettoyage.json');
  cleanupReportKey=auditKey(technical);
  message('Dossier de contrôle proposé au téléchargement. Enregistrez-le puis confirmez les vérifications ci-dessous.');
}));
for(const id of ['cleanup-parts','cleanup-export','cleanup-copies','cleanup-devices','cleanup-saved'])$(id).addEventListener('input',renderCleanup);
$('cleanup-guide-button').addEventListener('click',()=>{
  const decision=checklist();
  if(!decision.ready){message(decision.reason,true);return;}
  const technical=engine.snapshot().cleanup;
  $('cleanup-proof').textContent=`${status.database.verified} fichiers uniques contrôlés intégralement sur pCloud ; ${technical.archiveCount} parties Takeout inventoriées. Contrôle du ${new Date(technical.completedAt).toLocaleString('fr-FR')}.`;
  $('cleanup-dialog').showModal();
});
$('cleanup-close').addEventListener('click',()=>$('cleanup-dialog').close());
$('cleanup-open-google').addEventListener('click',event=>{
  const decision=checklist();if(!decision.ready){event.preventDefault();$('cleanup-dialog').close();message(decision.reason,true);}
});
$('backup-button').addEventListener('click',()=>act(async()=>download(await engine.journal.backup(),'passage-photos-journal.json')));
$('summary-button').addEventListener('click',()=>act(async()=>download(await summary(),'passage-photos-bilan.json')));
$('manifest-button').addEventListener('click',()=>act(async()=>{
  const quote=value=>{let cell=String(value??'');if(/^[=+\-@]/.test(cell))cell="'"+cell;return '"'+cell.replaceAll('"','""')+'"';};
  const rows=[['archive','source','sha256','sha1','taille','nom_pcloud','date_prise_de_vue','folderid','fileid','statut','dernier_controle','erreur']];
  for(const source of await engine.journal.all('sources')){
    const object=engine.objects.get(source.digest);
    rows.push([engine.archives.get(source.archive)?.name,source.path,object.sha256,object.sha1,object.size,object.name,object.captured,object.folderid,object.fileid,object.status,object.checked,object.error]);
  }
  download('\ufeff'+rows.map(row=>row.map(quote).join(',')).join('\r\n'),'passage-photos-manifeste.csv','text/csv;charset=utf-8');
}));
$('restore-button').addEventListener('click',()=>$('restore-file').click());
$('restore-file').addEventListener('change',()=>{
  const file=$('restore-file').files[0];if(!file)return;
  if(engine.objects.size&&!confirm('Restaurer remplacera le journal de ce navigateur. Sauvegardez le journal actuel avant de continuer. Continuer ?'))return;
  start('restore',async()=>{const data=JSON.parse(await file.text());await engine.journal.restore(data);await engine.load();engine.identity=null;message('Journal restauré. Reconnectez pCloud ; les fichiers distants seront contrôlés à la reprise.');});
});
$('persist-button').addEventListener('click',()=>act(async()=>{
  const granted=await navigator.storage?.persist?.();
  message(granted?'Stockage persistant accordé. Sauvegardez aussi le journal régulièrement.':'Le navigateur ne garantit pas la conservation du stockage. Sauvegardez régulièrement le journal de reprise.');
}));
$('copy-redirect').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(redirectURI());message('URI de redirection copiée.');}catch{message('URI : '+redirectURI());}});
$('help-button').addEventListener('click',()=>$('help-dialog').showModal());$('close-help').addEventListener('click',()=>$('help-dialog').close());
addEventListener('beforeunload',event=>{if(engine?.job.running){event.preventDefault();event.returnValue='';}});
async function initialize(){
  let auth,authError;
  try{auth=consumeCallback();}catch(error){authError=error;}
  try{
    if(!isSecureContext||!globalThis.indexedDB||!navigator.locks||!AbortSignal.any)throw new Error('Utilisez Chrome ou Edge récent, hors navigation privée, pour le stockage et la reprise.');
    const journal=await openJournal();engine=new BrowserMigration(journal,changed);await engine.load();engine.auth=auth;
    supported=true;$('redirect-uri').textContent=redirectURI();$('client-id').value=engine.settings.client_id;
    $('credentials-details').open=!engine.settings.client_id;status=engine.snapshot();render();
    if(authError)message(authError.message,true);else if(auth)await start('auth',signal=>engine.identify(signal));
  }catch(error){message(error.message,true);}
}
render();initialize();
setInterval(()=>{if(engine&&!engine.job.running){status=engine.snapshot();renderCleanup();}},60000);
