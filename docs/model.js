export const emptyStatus = () => ({
  settings: {paths: [], folder: 'Ma phototheque'},
  database: {total: 0, verified: 0, remaining: 0, errors: 0, bytes: 0, verified_bytes: 0, archives: [], binding: null, error_rows: []},
  pcloud: {configured: false, connected: false},
  job: {command: null, running: false, exit_code: null, paused: false},
  logs: [], log_sequence: 0
});

export function progressOf(database) {
  return database.total ? Math.min(100, Math.floor(database.verified / database.total * 100)) : 0;
}

export function bytes(value) {
  if (!value) return '0 octet';
  const units = ['octets', 'Ko', 'Mo', 'Go', 'To'];
  const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1000)));
  return new Intl.NumberFormat('fr-FR', {maximumFractionDigits: index ? 1 : 0}).format(value / 1000 ** index) + ' ' + units[index];
}

export function jobLabel(job) {
  if (job.running) return {auth: 'Connexion', scan: 'Analyse', run: 'En cours', verify: 'Vérification', restore: 'Restauration'}[job.command] || 'En cours';
  if (job.paused) return 'En pause';
  if (job.exit_code !== null) return job.exit_code === 0 ? ({auth: 'Connexion prête', scan: 'Analyse terminée', run: 'Transfert terminé', verify: 'Contrôle terminé'}[job.command] || 'Terminé') : 'À reprendre';
  return 'En attente';
}

export function readiness(status, connected) {
  const busy = status.job.running;
  const database = status.database;
  const incomplete = database.archives.some(archive => !archive.complete);
  return {
    auth: connected && status.pcloud.configured && !busy,
    scan: connected && status.settings.paths.length > 0 && !busy,
    run: connected && status.pcloud.connected && database.total > 0 && !incomplete && !busy && database.remaining > 0,
    verify: connected && status.pcloud.connected && Boolean(database.binding) && database.total > 0 && !busy,
    edit: connected && !busy,
    report: connected && database.archives.length > 0 && !busy
  };
}
