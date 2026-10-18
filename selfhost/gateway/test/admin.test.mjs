import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const web = mkdtempSync(path.join(tmpdir(), 'ktl-web-'));
mkdirSync(path.join(web, 'assets'));
writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>KTL</title>');
writeFileSync(path.join(web, 'version.txt'), '1.2.3');

process.env.KTL_WEB_ROOT = web;
process.env.KTL_SETTINGS_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'ktl-settings-')), 'settings.env');
process.env.KTL_ENV_KEYS = '';
process.env.KTL_JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.KTL_PG_SOCKET = '/tmp/ktl-test-socket';

const { createHandler } = await import('../server.mjs');
const settings = await import('../lib/settings.mjs');
const { config, validTimezone } = await import('../lib/config.mjs');
const { localDate, localHour } = await import('../lib/backup.mjs');
const { restoreCommands } = await import('../lib/restore.mjs');
const invites = await import('../lib/invites.mjs');

describe('admin routes', () => {
  let server;
  let base;
  before(async () => {
    server = http.createServer(createHandler({ feed: { on: () => () => {} } }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it('keeps every new admin route to signed-in owners', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const routes = [
      ['PUT', '/api/admin/household'],
      ['PATCH', `/api/admin/people/${id}`],
      ['POST', `/api/admin/people/${id}/owner`],
      ['POST', `/api/admin/people/${id}/invite`],
      ['POST', '/api/admin/test-address'],
      ['POST', '/api/admin/backups/upload'],
      ['POST', '/api/admin/restore']
    ];
    for (const [method, p] of routes) {
      const res = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(res.status, 401, `${method} ${p}`);
    }
  });

  it('says an invite that isn’t one is missing, without touching the database', async () => {
    const res = await fetch(`${base}/api/invite/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'nope' }) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { valid: false, state: 'missing' });
  });

  it('refuses a weak password before looking at the invite', async () => {
    const res = await fetch(`${base}/api/invite/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'x', password: 'short' }) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'weak_password');
  });

  it('stops answering invite checks after twenty tries', async () => {
    const statuses = [];
    for (let i = 0; i < 20; i++) {
      statuses.push((await fetch(`${base}/api/invite/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status);
    }
    assert.ok(statuses.includes(429));
  });
});

describe('invites', () => {
  it('finds the token in the link, or the whole message', () => {
    const token = 'A'.repeat(43);
    assert.equal(invites.tokenFrom(token), token);
    assert.equal(invites.tokenFrom(`https://ktl.example.com/join#${token}`), token);
    assert.equal(invites.tokenFrom(`Alex has invited you… until 14:00:\nhttps://ktl.example.com/join#${token}`), token);
    assert.equal(invites.tokenFrom('https://ktl.example.com/join'), '');
  });

  it('only stores a hash, and every token is different', () => {
    const a = invites.newToken();
    const b = invites.newToken();
    assert.notEqual(a, b);
    assert.ok(a.length >= 43);
    assert.equal(invites.hashToken(a), invites.hashToken(a));
    assert.notEqual(invites.hashToken(a), a);
  });

  it('knows used, cancelled and expired invites from valid ones', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    const later = '2026-10-20T13:00:00Z';
    assert.equal(invites.inviteState(null, now), 'missing');
    assert.equal(invites.inviteState({ expires_at: later, used_at: '2026-10-20T11:00:00Z' }, now), 'used');
    assert.equal(invites.inviteState({ expires_at: later, cancelled_at: '2026-10-20T11:00:00Z' }, now), 'cancelled');
    assert.equal(invites.inviteState({ expires_at: '2026-10-20T11:59:59Z' }, now), 'expired');
    assert.equal(invites.inviteState({ expires_at: later }, now), 'valid');
  });

  it('cancels the old invite, stores the hash and sets the expiry', async () => {
    const queries = [];
    const db = { query: async (sql, args) => { queries.push([sql, args]); return { rows: [] }; } };
    const now = Date.parse('2026-10-20T12:00:00Z');
    const { token, expiresAt } = await invites.createInvite(db, { userId: 'u1', createdBy: 'o1', expiresIn: '1h', now });
    assert.match(queries[0][0], /set cancelled_at = now\(\)/);
    assert.deepEqual(queries[0][1], ['u1']);
    assert.equal(queries[1][1][1], invites.hashToken(token));
    assert.equal(expiresAt.toISOString(), '2026-10-20T13:00:00.000Z');
    await assert.rejects(invites.createInvite(db, { userId: 'u1', expiresIn: '1y' }), /1 hour, 24 hours or 7 days/);
  });

  it('writes a message with the link and when it runs out', () => {
    const msg = invites.inviteMessage({ owner: 'Alex', household: 'Flat 4', link: 'https://ktl.example.com/join#abc', expiresAt: '2026-10-20T13:00:00Z', timeZone: 'Europe/London' });
    assert.match(msg, /^Alex has invited you to Flat 4 on KTL/);
    assert.match(msg, /works once, until 14:00, 20 Oct|works once, until 20 Oct, 14:00/);
    assert.match(msg, /https:\/\/ktl\.example\.com\/join#abc$/);
  });
});

describe('settings the admin page can now change', () => {
  it('reads the backup schedule and proxy setting live', () => {
    assert.equal(config.backupHour, 3);
    assert.equal(config.backupKeep, 14);
    assert.equal(config.trustProxy, false);
    settings.update({ KTL_BACKUP_HOUR: '5', KTL_BACKUP_KEEP: '0', KTL_TRUST_PROXY: 'true', KTL_TIMEZONE: 'Asia/Tokyo' });
    assert.equal(config.backupHour, 5);
    assert.equal(config.backupKeep, 0);
    assert.equal(config.trustProxy, true);
    assert.equal(config.timezone, 'Asia/Tokyo');
    assert.equal(settings.needsRestart(['KTL_BACKUP_HOUR', 'KTL_TRUST_PROXY', 'KTL_TIMEZONE']), false);
    settings.update({ KTL_BACKUP_HOUR: '', KTL_BACKUP_KEEP: '', KTL_TRUST_PROXY: '', KTL_TIMEZONE: '' });
  });

  it('falls back to London for a time zone that doesn’t exist', () => {
    assert.equal(validTimezone('Europe/London'), true);
    assert.equal(validTimezone('Mars/Olympus'), false);
    settings.update({ KTL_TIMEZONE: 'Mars/Olympus' });
    assert.equal(config.timezone, process.env.TZ && validTimezone(process.env.TZ) ? config.timezone : 'Europe/London');
    settings.update({ KTL_TIMEZONE: '' });
  });

  it('takes the nightly backup by the clock where the server is', () => {
    const d = new Date('2026-10-20T18:30:00Z');
    assert.equal(localHour(d, 'Europe/London'), 19);
    assert.equal(localHour(d, 'Asia/Tokyo'), 3);
    assert.equal(localDate(d, 'Asia/Tokyo'), '2026-10-21');
    assert.equal(localDate(d, 'Europe/London'), '2026-10-20');
  });
});

describe('restore', () => {
  it('loads the dump into a cleared database in one transaction, stopping at the first error', () => {
    const { dump, load } = restoreCommands('/data/backups/ktl-2026-10-20.dump');
    assert.deepEqual(dump, ['pg_restore', ['-f', '-', '/data/backups/ktl-2026-10-20.dump']]);
    assert.equal(load[0], 'psql');
    assert.ok(load[1].includes('-1'));
    assert.ok(load[1].includes('ON_ERROR_STOP=1'));
    const clear = load[1][load[1].indexOf('-c') + 1];
    assert.match(clear, /drop schema if exists private, ktl_meta, auth, extensions cascade/);
    assert.match(clear, /create schema public/);
  });
});

describe('update check', async () => {
  const { compareVersions, latestRelease, resetUpdateCache, updateStatus } = await import('../lib/updates.mjs');
  const release = (tag) => async () => ({ ok: true, json: async () => ({ tag_name: tag, html_url: `https://github.com/x/ktl/releases/tag/${tag}`, published_at: '2026-10-20T00:00:00Z' }) });

  it('compares versions as numbers, not text', () => {
    assert.equal(compareVersions('1.10.0', '1.9.3'), 1);
    assert.equal(compareVersions('v1.1.0', '1.1.0'), 0);
    assert.equal(compareVersions('1.0.9', '1.1.0'), -1);
  });

  it('says when a newer release is out, and asks GitHub at most every six hours', async () => {
    resetUpdateCache();
    let asked = 0;
    const fetchImpl = async (...args) => { asked++; return release('v1.2.0')(...args); };
    const now = Date.now();
    const s = await updateStatus('1.1.0', { env: {}, fetchImpl, now });
    assert.deepEqual({ latest: s.latest, newer: s.newer }, { latest: '1.2.0', newer: true });
    await latestRelease({ env: {}, fetchImpl, now: now + 60_000 });
    assert.equal(asked, 1);
  });

  it('can be turned off, and says nothing when GitHub can’t be reached', async () => {
    resetUpdateCache();
    assert.equal(await updateStatus('1.1.0', { env: { KTL_UPDATE_CHECK: 'false' }, fetchImpl: release('v9.9.9') }), null);
    resetUpdateCache();
    assert.equal(await updateStatus('1.1.0', { env: {}, fetchImpl: async () => { throw new Error('offline'); } }), null);
  });
});

describe('deal checks', () => {
  let server;
  let base;
  before(async () => {
    server = http.createServer(createHandler({ feed: { on: () => () => {} } }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it('wants a signed-in person, and the admin test wants the owner', async () => {
    const post = (p) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await post('/api/deals/check')).status, 401);
    assert.equal((await post('/api/admin/ai-test')).status, 401);
    assert.equal((await fetch(`${base}/api/deals/check/00000000-0000-4000-8000-000000000000`)).status, 401);
    assert.equal((await fetch(`${base}/api/deals/check/not-a-job`)).status, 404);
  });

  it('keeps the AI key secret, and says whether deal checks are on', async () => {
    settings.update({ KTL_AI_PROVIDER: 'anthropic', KTL_AI_API_KEY: 'sk-ant-secret' });
    assert.deepEqual(settings.describe().aiApiKey, { value: '', set: true, source: 'settings' });
    assert.equal(config.aiEnabled, true);
    const info = await (await fetch(`${base}/api/config`)).json();
    assert.equal(info.ai, true);
    settings.update({ KTL_AI_PROVIDER: '', KTL_AI_API_KEY: '' });
    assert.equal(config.aiEnabled, false);
  });
});
