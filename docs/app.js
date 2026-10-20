import {emptyStatus, progressOf, bytes, jobLabel, readiness} from './model.js';

const $ = id => document.getElementById(id);
const format = value => new Intl.NumberFormat('fr-FR').format(value);
const plural = (value, noun) => `${format(value)} ${noun}${value === 1 ? '' : 's'}`;
let status = emptyStatus();
let connected = false;
let polling = false;
let pending = false;
let lastLogSequence = -1;
let lastArchiveKey = '';
let folderDirty = false;
const fragment = new URLSearchParams(location.hash.slice(1));
let session = fragment.get('session');
let port = fragment.get('port') || sessionStorage.getItem('passage-port') || '8766';
if (session) {
  sessionStorage.setItem('passage-session', session);
  sessionStorage.setItem('passage-port', port);
  history.replaceState(null, '', location.pathname + location.search);
} else session = sessionStorage.getItem('passage-session');
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) port = '8766';
const endpoint = `http://127.0.0.1:${port}`;

async function api(path, body, download = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), path === '/api/pick' ? 310000 : 15000);
  try {
    const options = {method: body ? 'POST' : 'GET', headers: {Authorization: `Bearer ${session}`}, signal: controller.signal};
    if (body) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    // Newer browsers may ask permission to reach the loopback companion.
    options.targetAddressSpace = 'loopback';
    const response = await fetch(endpoint + path, options);
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || `Le compagnon a répondu avec une erreur (${response.status}).`);
    }
    return download ? response.blob() : response.json();
  } finally { clearTimeout(timer); }
}

function message(text, error = false) {
  $('notice').textContent = text;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = !text;
}

function archiveRows(database) {
  const key = JSON.stringify(database.archives);
  if (key === lastArchiveKey) return;
  lastArchiveKey = key;
  $('archives-section').hidden = !database.archives.length;
  $('archives-count').textContent = plural(database.archives.length, 'partie');
  $('archive-list').replaceChildren(...database.archives.map(archive => {
    const row = document.createElement('div'); row.className = 'archive-row';
    const name = document.createElement('span'); name.textContent = archive.path.split(/[\\/]/).pop(); name.title = archive.path;
    const state = document.createElement('span'); state.className = 'small';
    state.textContent = !archive.complete ? 'Analyse incomplète' : archive.remaining ? `${plural(archive.remaining, 'fichier')} à transférer` : 'Tous les fichiers vérifiés';
    row.append(name, state); return row;
  }));
}

function render() {
  const {database: db, pcloud, job, settings} = status;
  const ready = readiness(status, connected);
  const busy = job.running || pending;
  $('connect-panel').hidden = connected;
  $('connection-badge').textContent = connected ? 'Ordinateur connecté' : 'Ordinateur non connecté';
  $('connection-badge').classList.toggle('connected', connected);
  $('pcloud-state').textContent = pcloud.connected ? 'Accès enregistré' : pcloud.configured ? 'À connecter' : 'À préparer';
  $('pcloud-state').classList.toggle('done', pcloud.connected);
  $('pcloud-description').textContent = pcloud.connected ? `Compte pCloud ${pcloud.userid || ''} · ${pcloud.hostname === 'eapi.pcloud.com' ? 'Europe' : 'États-Unis'}` : 'Le compte qui recevra vos photos et vidéos.';
  $('auth-button').textContent = pcloud.connected ? 'Reconnecter pCloud' : 'Connecter mon compte pCloud';
  $('auth-button').disabled = !ready.auth || pending;
  $('credentials-fields').disabled = !ready.edit || pending;
  $('paths-fields').disabled = !ready.edit || pending;
  $('pick-button').disabled = !ready.edit || pending;
  $('scan-button').disabled = !ready.scan || pending;
  $('folder').disabled = !ready.edit || Boolean(db.binding) || pending;
  if (db.binding || (!folderDirty && document.activeElement !== $('folder'))) $('folder').value = db.binding?.initial_name || settings.folder;
  $('folder-help').textContent = db.binding ? 'Destination liée au journal. Vous pouvez renommer ce dossier directement dans pCloud.' : 'Vous pourrez le renommer dans pCloud après sa création.';
  $('selection-label').textContent = settings.paths.length === 1 ? settings.paths[0].split(/[\\/]/).pop() : settings.paths.length ? `${format(settings.paths.length)} archives ou dossiers sélectionnés` : 'Aucune archive sélectionnée';
  $('selection-detail').textContent = settings.paths.length ? 'Archives conservées sur votre ordinateur.' : 'Vous pouvez ajouter les parties une par une.';
  $('archive-state').textContent = !db.archives.length ? 'À préparer' : db.archives.some(a => !a.complete) ? 'Analyse incomplète' : `${plural(db.archives.length, 'partie')} ${db.archives.length === 1 ? 'analysée' : 'analysées'}`;
  $('archive-state').classList.toggle('done', db.archives.length > 0 && db.archives.every(a => a.complete));
  $('run-button').disabled = !ready.run || pending;
  $('run-button').textContent = db.total && db.remaining === 0 ? 'Tous les fichiers sont vérifiés' : db.verified || job.paused || db.errors ? 'Reprendre le transfert' : 'Lancer le transfert';
  $('run-hint').textContent = !connected ? "Reliez d'abord cet ordinateur." : busy ? 'Une opération est en cours.' : !pcloud.connected ? 'Connectez votre compte pCloud.' : !db.total ? 'Analysez vos archives pour continuer.' : db.archives.some(a => !a.complete) ? 'Terminez l’analyse des archives.' : db.remaining === 0 ? 'Lancez le contrôle final.' : 'Les fichiers déjà vérifiés sont conservés.';
  $('job-state').textContent = jobLabel(job);
  const percent = progressOf(db);
  $('progress').value = percent;
  $('percent').textContent = `${percent} %`;
  $('progress-caption').textContent = db.total ? `${plural(db.total, 'fichier')} ${db.total === 1 ? 'unique' : 'uniques'}` : 'Aucun fichier analysé';
  for (const field of ['verified', 'remaining', 'errors']) $('count-' + field).textContent = format(db[field]);
  $('count-errors').classList.toggle('has-errors', db.errors > 0);
  $('volume').textContent = db.bytes ? `${bytes(db.verified_bytes)} / ${bytes(db.bytes)}` : '0 octet';
  const activity = job.running ? {auth: 'Autorisez la connexion dans la fenêtre pCloud ouverte.', scan: 'Lecture des archives et calcul des empreintes. Cela peut prendre du temps.', run: 'Envoi et vérification des fichiers sur pCloud.', verify: 'Contrôle des fichiers reçus sur pCloud.'}[job.command] : job.paused ? 'Opération en pause. Vous pouvez reprendre sans repartir de zéro.' : job.exit_code && job.exit_code !== 0 ? 'L’opération s’est arrêtée. Consultez le journal, corrigez la cause puis reprenez.' : job.command === 'verify' && job.exit_code === 0 ? 'Contrôle terminé. Comparez aussi les parties traitées avec votre export Google.' : db.total && !db.remaining ? 'Tous les fichiers inventoriés sont vérifiés. Pensez au contrôle final.' : db.total ? (pcloud.connected ? 'Votre inventaire est prêt. Lancez ou reprenez le transfert.' : 'Votre inventaire est prêt. Connectez pCloud pour continuer.') : 'Préparez votre connexion et vos archives pour commencer.';
  $('activity').textContent = activity;
  $('live-detail').textContent = job.running && status.logs.length ? status.logs.at(-1) : '';
  $('live-detail').hidden = !$('live-detail').textContent;
  $('pause-button').hidden = !job.running;
  $('pause-button').disabled = pending || job.paused;
  $('pause-button').textContent = job.command === 'auth' ? 'Annuler la connexion' : job.command === 'scan' ? 'Interrompre l’analyse' : 'Mettre en pause';
  $('verify-button').disabled = !ready.verify || pending;
  $('deep').disabled = !ready.verify || pending;
  $('manifest-button').disabled = !ready.report || pending;
  $('summary-button').disabled = !ready.report || pending;
  if (status.log_sequence !== lastLogSequence) {
    const atBottom = $('logs').scrollHeight - $('logs').scrollTop - $('logs').clientHeight < 60;
    $('logs').textContent = status.logs.join('\n') || 'Les opérations apparaîtront ici.';
    if (atBottom) $('logs').scrollTop = $('logs').scrollHeight;
    lastLogSequence = status.log_sequence;
  }
  archiveRows(db);
  $('errors-section').hidden = !db.error_rows.length;
  $('error-list').replaceChildren(...db.error_rows.map(error => { const li = document.createElement('li'); li.textContent = `${error.name} : ${error.error}`; return li; }));
}

async function refresh() {
  if (!session || polling) return;
  polling = true;
  try {
    status = await api('/api/status');
    connected = true;
    $('connection-error').hidden = true;
  } catch (error) {
    connected = false;
    $('connection-error').textContent = 'Liaison locale indisponible. Ouvrez Lancer-interface.cmd ; autorisez l’accès au réseau local si votre navigateur le demande. Sinon, utilisez Lancer-interface-locale.cmd.';
    $('connection-error').hidden = false;
  } finally { polling = false; render(); }
}

async function act(operation) {
  if (pending) return;
  pending = true; render(); message('');
  try { await operation(); await refresh(); }
  catch (error) { message(error.message || 'L’opération a échoué. Consultez le journal.', true); }
  finally { pending = false; render(); }
}

$('credentials-form').addEventListener('submit', event => { event.preventDefault(); act(async () => {
  await api('/api/settings', {client_id: $('client-id').value, client_secret: $('client-secret').value});
  $('client-secret').value = ''; $('client-id').value = '';
  $('credentials-details').open = false;
  message('Accès enregistrés sur cet ordinateur. Cliquez sur « Connecter mon compte pCloud ».');
}); });
$('auth-button').addEventListener('click', () => act(() => api('/api/start', {command: 'auth'})));
$('pick-button').addEventListener('click', () => act(async () => { message('Choisissez les ZIP dans la fenêtre de votre ordinateur.'); await api('/api/pick', {}); message(''); }));
$('paths-form').addEventListener('submit', event => { event.preventDefault(); act(async () => {
  const paths = $('paths').value.split(/\r?\n/).map(path => path.trim().replace(/^"|"$/g, '')).filter(Boolean);
  if (!paths.length) throw new Error('Indiquez au moins un chemin.');
  await api('/api/settings', {paths}); message('Chemins enregistrés. Vous pouvez analyser les archives.');
}); });
$('scan-button').addEventListener('click', () => act(() => api('/api/start', {command: 'scan'})));
$('run-button').addEventListener('click', () => act(async () => {
  if (!status.database.binding) await api('/api/settings', {folder: $('folder').value});
  folderDirty = false;
  await api('/api/start', {command: 'run'});
}));
$('folder').addEventListener('input', () => { folderDirty = true; });
$('pause-button').addEventListener('click', () => act(() => api('/api/pause', {})));
$('verify-button').addEventListener('click', () => act(() => api('/api/start', {command: 'verify', deep: $('deep').checked})));
for (const [id, route, filename] of [['manifest-button','manifest','manifest.csv'], ['summary-button','summary','summary.json']]) {
  $(id).addEventListener('click', () => act(async () => {
    const blob = await api('/api/' + route, undefined, true);
    const href = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = href; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  }));
}
$('copy-redirect').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText('http://127.0.0.1:8765/callback'); message('URI de redirection copiée.'); }
  catch { message('Copiez cette URI : http://127.0.0.1:8765/callback'); }
});
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
render(); refresh(); setInterval(refresh, 2500);
