import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { SOCKET_DIR } from './db.mjs';

/* A consistent copy of the whole database (accounts included) every
   night, kept for `backupKeep` days in /data/backups. Copying the live
   Postgres folder isn't a backup — it can catch the files mid-write —
   so this is what an appdata backup plugin should pick up instead.

   Restore: ktl-admin restore /data/backups/ktl-YYYY-MM-DD.dump */

/* Today's date where the server is (YYYY-MM-DD), and the hour there. */
export function localDate(d = new Date(), timeZone = config.timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function localHour(d = new Date(), timeZone = config.timezone) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(d));
}
const stamp = (d = new Date()) => localDate(d);

export function listBackups(dir = config.backupDir) {
  try {
    return readdirSync(dir)
      .filter((f) => /^ktl-\d{4}-\d{2}-\d{2}.*\.dump$/.test(f))
      .map((f) => {
        const st = statSync(path.join(dir, f));
        return { file: path.join(dir, f), name: f, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function runBackup({ dir = config.backupDir, label = '' } = {}) {
  mkdirSync(dir, { recursive: true });
  const name = `ktl-${stamp()}${label ? `-${label}` : ''}.dump`;
  const file = path.join(dir, name);
  const tmp = `${file}.partial`;
  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', ['-h', SOCKET_DIR, '-U', 'postgres', '-Fc', '-f', tmp, 'postgres'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        rmSync(tmp, { force: true });
        reject(new Error(`pg_dump exited ${code}: ${stderr.trim()}`));
        return;
      }
      renameSync(tmp, file);
      prune(dir);
      resolve(file);
    });
  });
}

function prune(dir) {
  if (config.backupKeep <= 0) return; // nightly backups off: keep what's there
  const nightly = listBackups(dir).filter((b) => /^ktl-\d{4}-\d{2}-\d{2}\.dump$/.test(b.name));
  nightly.slice(0, Math.max(0, nightly.length - config.backupKeep)).forEach((b) => rmSync(b.file, { force: true }));
}

/* Checked every half hour, so a change of time or "off" on the admin page
   applies from the next check. */
export function scheduleBackups() {
  const tick = () => {
    if (config.backupKeep <= 0) return;
    const now = new Date();
    if (localHour(now) < config.backupHour) return;
    if (listBackups().some((b) => b.name === `ktl-${stamp(now)}.dump`)) return;
    runBackup()
      .then((file) => console.log(`gateway: backed up to ${file}`))
      .catch((err) => console.error('gateway: nightly backup failed', err.message));
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 30 * 60_000).unref();
}
