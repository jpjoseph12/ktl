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

const stamp = (d = new Date()) => d.toISOString().slice(0, 10);

export function listBackups(dir = config.backupDir) {
  try {
    return readdirSync(dir)
      .filter((f) => /^ktl-\d{4}-\d{2}-\d{2}.*\.dump$/.test(f))
      .map((f) => ({ file: path.join(dir, f), name: f, size: statSync(path.join(dir, f)).size }))
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
  const nightly = listBackups(dir).filter((b) => /^ktl-\d{4}-\d{2}-\d{2}\.dump$/.test(b.name));
  nightly.slice(0, Math.max(0, nightly.length - config.backupKeep)).forEach((b) => rmSync(b.file, { force: true }));
}

export function scheduleBackups() {
  if (config.backupKeep <= 0) {
    console.log('gateway: nightly backups off (KTL_BACKUP_KEEP=0)');
    return;
  }
  const tick = () => {
    const now = new Date();
    if (now.getHours() < config.backupHour) return;
    if (listBackups().some((b) => b.name === `ktl-${stamp(now)}.dump`)) return;
    runBackup()
      .then((file) => console.log(`gateway: backed up to ${file}`))
      .catch((err) => console.error('gateway: nightly backup failed', err.message));
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 30 * 60_000).unref();
}
