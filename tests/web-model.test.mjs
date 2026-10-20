import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyStatus, readiness, progressOf, bytes, jobLabel} from '../docs/model.js';

test('Empty interface never enables transfer or shows invented progress', () => {
  const status = emptyStatus();
  assert.equal(progressOf(status.database), 0);
  assert.equal(readiness(status, false).run, false);
  assert.equal(readiness(status, true).verify, false);
  assert.equal(bytes(0), '0 octet');
});

test('Completed inventories and pCloud access are required before transfer', () => {
  const status = emptyStatus();
  status.database = {...status.database, total: 10, verified: 4, remaining: 6, archives: [{complete: 1}]};
  assert.equal(progressOf(status.database), 40);
  assert.equal(readiness(status, true).run, false);
  status.pcloud.connected = true;
  assert.equal(readiness(status, true).run, true);
  status.database.archives.push({complete: 0});
  assert.equal(readiness(status, true).run, false);
});

test('Pause, errors, busy jobs and missing connection retain truthful states', () => {
  const status = emptyStatus();
  status.job = {command: 'run', running: false, paused: true, exit_code: -1};
  assert.equal(jobLabel(status.job), 'En pause');
  status.job.paused = false;
  assert.equal(jobLabel(status.job), 'À reprendre');
  status.job.running = true;
  assert.equal(readiness(status, true).edit, false);
  assert.equal(jobLabel(status.job), 'En cours');
  status.job = {command: 'verify', running: false, exit_code: 0};
  assert.equal(jobLabel(status.job), 'Contrôle terminé');
  assert.equal(readiness(status, false).auth, false);
});
