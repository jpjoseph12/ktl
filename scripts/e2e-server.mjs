/* A throwaway KTL server for the end-to-end tests.
 *
 *   node scripts/e2e-server.mjs            start it (from the ktl:latest image) and set it up
 *   node scripts/e2e-server.mjs --stop     remove it again
 *
 * It runs on port 8095 with no volume, so nothing survives --stop. Setup
 * goes through the same /setup API a person would use: the setup code from
 * the container's log, then the owner's account (the one the tests sign in
 * as) and a second person, since splitting a bill needs someone to split
 * it with. The emulator reaches it at http://10.0.2.2:8095.
 */
import { execFileSync } from 'node:child_process';

const NAME = process.env.KTL_E2E_CONTAINER || 'ktl-e2e';
const PORT = process.env.KTL_E2E_PORT || '8095';
const IMAGE = process.env.KTL_E2E_IMAGE || 'ktl:latest';
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = process.env.E2E_EMAIL || 'e2e-owner@ktl.test';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e-password-123';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${out.message || out.msg || JSON.stringify(out)}`);
  return out;
}

if (process.argv.includes('--stop')) {
  try { docker('rm', '-f', NAME); } catch { /* not running */ }
  console.log(`Removed ${NAME}.`);
  process.exit(0);
}

try { docker('rm', '-f', NAME); } catch { /* not running */ }
docker('run', '-d', '--name', NAME, '-p', `${PORT}:3000`, IMAGE);
console.log(`Started ${NAME} on :${PORT}, waiting for it to come up…`);

for (let i = 0; ; i++) {
  try {
    const health = await json('/healthz');
    if (health.status === 'ok') break;
  } catch { /* not yet */ }
  if (i > 90) throw new Error('The server never became healthy. See: docker logs ' + NAME);
  await sleep(2000);
}

const code = docker('exec', NAME, 'ktl-admin', 'setup-code');
await json('/api/setup/claim', {
  method: 'POST',
  body: {
    code,
    siteUrl: `http://10.0.2.2:${PORT}`,
    household: 'E2E household',
    name: 'E2E Owner',
    email: EMAIL,
    password: PASSWORD
  }
});

const { access_token: token } = await json('/auth/v1/token?grant_type=password', {
  method: 'POST',
  body: { email: EMAIL, password: PASSWORD }
});
await json('/api/admin/people', { method: 'POST', token, body: { name: 'E2E Partner', email: 'e2e-partner@ktl.test' } });

console.log(`Ready: ${EMAIL} owns "E2E household", with one other person in it.`);
