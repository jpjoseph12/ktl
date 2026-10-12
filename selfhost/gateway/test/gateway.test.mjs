import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const web = mkdtempSync(path.join(tmpdir(), 'ktl-web-'));
mkdirSync(path.join(web, 'assets'));
writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>KTL</title>');
writeFileSync(path.join(web, 'assets', 'index-AbCdEf12.js'), 'console.log(1)');
writeFileSync(path.join(web, 'version.txt'), '1.2.3');
writeFileSync(path.join(path.dirname(web), 'secret.txt'), 'nope');
const settingsFile = path.join(mkdtempSync(path.join(tmpdir(), 'ktl-settings-')), 'settings.env');

process.env.KTL_WEB_ROOT = web;
process.env.KTL_SETTINGS_FILE = settingsFile;
// As if the container itself set the address (env.sh records which keys it set).
process.env.KTL_SITE_URL = 'https://ktl.example.com';
process.env.KTL_ENV_KEYS = 'KTL_SITE_URL';
process.env.KTL_JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.KTL_SETUP_CODE = 'ABCD-EF23';

const { signJwt, verifyJwt, looksLikeJwt } = await import('../lib/jwt.mjs');
const { createHandler, clientIp } = await import('../server.mjs');
const { migrationFiles } = await import('../setup.mjs');
const { codeMatches, normaliseSiteUrl } = await import('../lib/portal-api.mjs');
const settings = await import('../lib/settings.mjs');
const { config } = await import('../lib/config.mjs');

describe('jwt', () => {
  const secret = process.env.KTL_JWT_SECRET;

  it('verifies what it signs, and nothing else', () => {
    const token = signJwt({ sub: 'u1', role: 'authenticated' }, secret);
    assert.equal(verifyJwt(token, secret).sub, 'u1');
    assert.equal(verifyJwt(token, 'another-secret'), null);
    const [h, b] = token.split('.');
    assert.equal(verifyJwt(`${h}.${b}.forged`, secret), null);
  });

  it('rejects expired tokens and other algorithms', () => {
    const expired = signJwt({ sub: 'u1' }, secret, { expiresIn: -10 });
    assert.equal(verifyJwt(expired, secret), null);
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"u1"}').toString('base64url')}.`;
    assert.equal(verifyJwt(none, secret), null);
  });

  it('tells a token from the placeholder API key', () => {
    assert.equal(looksLikeJwt(signJwt({}, secret)), true);
    assert.equal(looksLikeJwt('ktl-self-hosted'), false);
  });
});

describe('clientIp', () => {
  const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

  it('believes Cloudflare only when the tunnel is the caller', () => {
    assert.equal(clientIp(req('127.0.0.1', { 'cf-connecting-ip': '81.2.3.4' })), '81.2.3.4');
    assert.equal(clientIp(req('192.168.0.50', { 'cf-connecting-ip': '81.2.3.4' })), '192.168.0.50');
  });

  it('ignores a forged X-Forwarded-For from the LAN', () => {
    assert.equal(clientIp(req('::ffff:192.168.0.50', { 'x-forwarded-for': '1.1.1.1' })), '192.168.0.50');
  });
});

describe('migrationFiles', () => {
  it('orders migrations by version', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ktl-mig-'));
    ['20260912000000_b.sql', '20260909000000_a.sql', 'README.md'].forEach((f) => writeFileSync(path.join(dir, f), ''));
    assert.deepEqual(migrationFiles(dir).map((m) => m.name), ['a', 'b']);
  });
});

describe('gateway routing', () => {
  let server;
  let base;
  before(async () => {
    server = http.createServer(createHandler({ feed: { on: () => () => {} } }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it('serves the app for client-side routes, with a strict content policy', async () => {
    const res = await fetch(`${base}/android/home`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>KTL<\/title>/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
  });

  it('caches hashed assets for good', async () => {
    const res = await fetch(`${base}/assets/index-AbCdEf12.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control'), /immutable/);
  });

  it('404s a missing file instead of handing back the app', async () => {
    assert.equal((await fetch(`${base}/assets/missing-12345678.js`)).status, 404);
  });

  it('never serves anything outside the web folder', async () => {
    const res = await fetch(`${base}/..%2Fsecret.txt`);
    assert.notEqual(await res.text(), 'nope');
  });

  it('keeps GoTrue’s admin API off the internet', async () => {
    const res = await fetch(`${base}/auth/v1/admin/users`);
    assert.equal(res.status, 404);
  });

  it('answers the Android app’s preflight, and nobody else’s', async () => {
    const ok = await fetch(`${base}/rest/v1/bills`, { method: 'OPTIONS', headers: { Origin: 'https://localhost', 'Access-Control-Request-Headers': 'authorization' } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://localhost');
    const other = await fetch(`${base}/rest/v1/bills`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
  });


  it('wants a signed-in token for the live stream and account deletion', async () => {
    assert.equal((await fetch(`${base}/live?household=x`)).status, 401);
    assert.equal((await fetch(`${base}/api/account/delete`, { method: 'POST' })).status, 401);
  });
});

describe('settings saved from the admin page', () => {
  it('round-trips any value through the file, quotes and all', () => {
    const awkward = "p'a$s\"w`d;rm -rf /";
    const text = settings.serialiseSettings({ KTL_SMTP_PASS: awkward, KTL_SMTP_HOST: 'smtp.example.com' });
    assert.deepEqual(settings.parseSettings(text), { KTL_SMTP_PASS: awkward, KTL_SMTP_HOST: 'smtp.example.com' });
  });

  it('saves known settings only, and never overrides one the container set', () => {
    const changed = settings.update({ KTL_SMTP_HOST: 'smtp.example.com', KTL_SITE_URL: 'https://elsewhere.example', EVIL: 'x' });
    assert.deepEqual(changed, ['KTL_SMTP_HOST']);
    assert.equal(config.siteUrl, 'https://ktl.example.com');
    assert.equal(config.emailEnabled, true);
    settings.update({ KTL_SMTP_HOST: '' });
    assert.equal(config.emailEnabled, false);
  });

  it('shows secrets only as set or not', () => {
    settings.update({ KTL_SMTP_PASS: 'hunter2-hunter2' });
    const d = settings.describe();
    assert.deepEqual(d.smtpPass, { value: '', set: true, source: 'settings' });
    assert.equal(d.siteUrl.source, 'container');
    settings.update({ KTL_SMTP_PASS: '' });
  });

  it('keeps sign-ups closed until someone opens them', () => {
    assert.equal(config.allowSignup, false);
    settings.update({ KTL_ALLOW_SIGNUP: 'true' });
    assert.equal(config.allowSignup, true);
    settings.update({ KTL_ALLOW_SIGNUP: 'false' });
  });
});

describe('setup and admin', () => {
  let server;
  let base;
  before(async () => {
    server = http.createServer(createHandler({ feed: { on: () => () => {} } }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it('accepts the setup code however it is typed, and nothing else', () => {
    assert.equal(codeMatches('abcd ef23', 'ABCD-EF23'), true);
    assert.equal(codeMatches('ABCD-EF24', 'ABCD-EF23'), false);
    assert.equal(codeMatches('', ''), false);
  });

  it('turns a typed address into the site’s origin', () => {
    assert.equal(normaliseSiteUrl('ktl.example.com/android/home'), 'https://ktl.example.com');
    assert.equal(normaliseSiteUrl('http://192.168.1.20:8095'), 'http://192.168.1.20:8095');
    assert.equal(normaliseSiteUrl('ftp://x'), '');
  });

  it('says it is a KTL server, even before its database is up', async () => {
    const info = await (await fetch(`${base}/api/config`)).json();
    assert.equal(info.app, 'ktl');
    assert.equal(info.version, '1.2.3');
    assert.equal(info.ready, false);
    assert.equal(info.signup, false);
  });

  it('refuses sign-ups while they are closed, without bothering the sign-in service', async () => {
    const res = await fetch(`${base}/auth/v1/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error_code, 'signup_disabled');
  });

  it('keeps the admin API to signed-in people', async () => {
    assert.equal((await fetch(`${base}/api/admin`)).status, 401);
    const forged = signJwt({ sub: '00000000-0000-4000-8000-000000000000' }, 'not-the-server-secret');
    assert.equal((await fetch(`${base}/api/admin`, { headers: { Authorization: `Bearer ${forged}` } })).status, 401);
    assert.equal((await fetch(`${base}/api/admin/people/not-a-uuid`, { method: 'DELETE' })).status, 404);
  });

  it('locks the setup page after five wrong codes, before touching the database', async () => {
    const post = () => fetch(`${base}/api/setup/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'WRONG-CODE' }) });
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await post()).status);
    assert.deepEqual(statuses, [403, 403, 403, 403, 403, 429]);
  });
});
