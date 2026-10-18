import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';

/* Server settings someone can change from the admin page, kept in
 * /data/config/settings.env as KEY='value' lines so the shell scripts that start
 * the sign-in service and the tunnel can source them too.
 *
 * A container environment variable always wins over the file: whoever set
 * one on purpose (an Unraid template, a compose file) gets what they set,
 * and the admin page shows that setting as "set by the container".
 */

export const SETTINGS_FILE = process.env.KTL_SETTINGS_FILE || '/data/config/settings.env';

/* Every setting the admin page can change, with the variable it lives in. */
export const KEYS = {
  siteUrl: 'KTL_SITE_URL',
  signup: 'KTL_ALLOW_SIGNUP',
  smtpHost: 'KTL_SMTP_HOST',
  smtpPort: 'KTL_SMTP_PORT',
  smtpUser: 'KTL_SMTP_USER',
  smtpPass: 'KTL_SMTP_PASS',
  smtpSender: 'KTL_SMTP_SENDER',
  smtpSenderName: 'KTL_SMTP_SENDER_NAME',
  tunnelToken: 'CLOUDFLARE_TUNNEL_TOKEN',
  trustProxy: 'KTL_TRUST_PROXY',
  backupHour: 'KTL_BACKUP_HOUR',
  backupKeep: 'KTL_BACKUP_KEEP',
  timezone: 'KTL_TIMEZONE',
  aiProvider: 'KTL_AI_PROVIDER',
  aiApiKey: 'KTL_AI_API_KEY',
  aiModel: 'KTL_AI_MODEL'
};
const SECRET = new Set(['KTL_SMTP_PASS', 'CLOUDFLARE_TUNNEL_TOKEN', 'KTL_AI_API_KEY']);

/* The environment as the container started it — before env.sh merged the
   settings file in — so the gateway can tell "set by the container" from
   "set here". env.sh records which keys came from the container in
   KTL_ENV_KEYS. */
const containerKeys = new Set((process.env.KTL_ENV_KEYS || '').split(',').filter(Boolean));

export function parseSettings(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2];
    if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) v = v.slice(1, -1).replace(/'"'"'/g, "'");
    out[m[1]] = v;
  }
  return out;
}

/* Single-quoted for the shell: nothing inside is expanded, and a quote in
   the value can't end the string early. */
export function shellQuote(v) {
  return `'${String(v).replace(/'/g, `'"'"'`)}'`;
}

export function serialiseSettings(values) {
  return Object.entries(values)
    .filter(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k) && v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${shellQuote(String(v).replace(/[\r\n]/g, ''))}`)
    .join('\n') + '\n';
}

let cache = { mtime: -1, values: {} };
export function readSettingsFile() {
  if (!existsSync(SETTINGS_FILE)) return {};
  const mtime = statSync(SETTINGS_FILE).mtimeMs;
  if (mtime !== cache.mtime) cache = { mtime, values: parseSettings(readFileSync(SETTINGS_FILE, 'utf8')) };
  return cache.values;
}

/* The value in effect, and where it came from. */
export function resolve(key, env = process.env) {
  if (containerKeys.has(key) && env[key]) return { value: env[key], source: 'container' };
  const file = readSettingsFile();
  if (file[key]) return { value: file[key], source: 'settings' };
  return { value: '', source: 'unset' };
}

export function get(key) {
  return resolve(key).value;
}

/* Merges `changes` ({ KTL_X: value }, '' to clear) into the file, written
   atomically. Keys the container sets are left alone. Returns the keys
   that actually changed. */
export function update(changes) {
  const current = { ...readSettingsFile() };
  const changed = [];
  for (const [k, v] of Object.entries(changes)) {
    if (!Object.values(KEYS).includes(k) || containerKeys.has(k)) continue;
    const next = v === undefined || v === null ? '' : String(v).trim();
    if ((current[k] || '') === next) continue;
    if (next) current[k] = next; else delete current[k];
    changed.push(k);
  }
  if (changed.length) {
    const tmp = `${SETTINGS_FILE}.tmp`;
    writeFileSync(tmp, serialiseSettings(current), { mode: 0o640 });
    renameSync(tmp, SETTINGS_FILE);
    // Two saves inside the filesystem's timestamp resolution leave the
    // mtime unchanged, so refresh the cache here rather than trust it.
    cache = { mtime: statSync(SETTINGS_FILE).mtimeMs, values: current };
  }
  return changed;
}

/* Keys the sign-in service or the tunnel only read when they start. */
const NEEDS_RESTART = new Set(['KTL_SITE_URL', 'KTL_SMTP_HOST', 'KTL_SMTP_PORT', 'KTL_SMTP_USER', 'KTL_SMTP_PASS', 'KTL_SMTP_SENDER', 'KTL_SMTP_SENDER_NAME', 'CLOUDFLARE_TUNNEL_TOKEN']);
export const APPLIED_FILE = process.env.KTL_SETTINGS_APPLIED || '/run/ktl/settings.applied';

export function needsRestart(changedKeys) {
  return changedKeys.some((k) => NEEDS_RESTART.has(k));
}

/* Waits until the settings-watch service has restarted sign-in with the
   file as it is now, so a reset link made straight after changing the
   address already uses the new one. Gives up quietly after `timeoutMs`
   (the change still lands, just a moment later). */
export async function waitUntilApplied({ timeoutMs = 20000 } = {}) {
  const want = existsSync(SETTINGS_FILE) ? createHash('md5').update(readFileSync(SETTINGS_FILE)).digest('hex') : '';
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if (readFileSync(APPLIED_FILE, 'utf8').trim() === want) return true;
    } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/* What the admin page may show: secrets only as "set" or not. */
export function describe() {
  const out = {};
  for (const [name, key] of Object.entries(KEYS)) {
    const { value, source } = resolve(key);
    out[name] = { value: SECRET.has(key) ? '' : value, set: Boolean(value), source };
  }
  return out;
}
