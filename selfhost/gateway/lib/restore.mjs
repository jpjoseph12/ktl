import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { runBackup } from './backup.mjs';
import { SOCKET_DIR, withClient } from './db.mjs';

/* Replaces everything with a backup, in one transaction: if anything
   fails, nothing changed. A fresh backup of the current data is taken
   first, just in case. Used by `ktl-admin restore` and the admin page.

   The backup is a whole-database dump. Replaying it over the existing
   schemas (pg_restore --clean) trips over objects that depend on each
   other across schemas, so instead: drop KTL's schemas, then load the
   dump — both in one psql transaction. */

export const RESTART_REQUEST = process.env.KTL_RESTART_REQUEST || '/data/config/restart.request';

const CLEAR = [
  'drop schema if exists private, ktl_meta, auth, extensions cascade',
  'drop schema if exists public cascade',
  'create schema public authorization pg_database_owner'
].join('; ');

/* The two processes a restore runs, piped together: exported so the
   arguments can be checked without a database. */
export function restoreCommands(file) {
  return {
    dump: ['pg_restore', ['-f', '-', file]],
    load: ['psql', ['-X', '-q', '-1', '-v', 'ON_ERROR_STOP=1', '-h', SOCKET_DIR, '-U', 'postgres', '-d', 'postgres', '-c', CLEAR, '-f', '-']]
  };
}

let running = false;

export async function restoreBackup(file, { onSafetyCopy = () => {} } = {}) {
  if (running) throw Object.assign(new Error('A restore is already running.'), { code: 'restore_running' });
  running = true;
  try {
    onSafetyCopy(await runBackup({ label: 'before-restore' }));
    await withClient((c) => c.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'postgres' and pid <> pg_backend_pid()"
    ));
    const { dump, load } = restoreCommands(file);
    const sql = spawn(dump[0], dump[1], { stdio: ['ignore', 'pipe', 'inherit'] });
    const psql = spawn(load[0], load[1], { stdio: ['pipe', 'ignore', 'inherit'] });
    sql.stdout.pipe(psql.stdin);
    const [dumpOk, loadOk] = await Promise.all([
      new Promise((r) => { sql.on('close', (code) => r(code === 0)); sql.on('error', () => r(false)); }),
      new Promise((r) => { psql.on('close', (code) => r(code === 0)); psql.on('error', () => r(false)); })
    ]);
    if (!dumpOk || !loadOk) throw Object.assign(new Error('Restore failed; nothing was changed.'), { code: 'restore_failed' });
  } finally {
    running = false;
  }
}

/* Asks the settings-watch service (which runs as root) to restart sign-in
   and the data API, so they pick up the restored database. */
export function requestRestart() {
  writeFileSync(RESTART_REQUEST, String(Date.now()));
}
