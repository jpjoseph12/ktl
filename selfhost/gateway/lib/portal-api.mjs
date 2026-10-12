import { timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import * as settings from './settings.mjs';
import { getPool } from './db.mjs';
import { gotrueAdmin } from './gotrue-admin.mjs';
import { bearer, verifyJwt } from './jwt.mjs';
import { listBackups, runBackup } from './backup.mjs';
import { parseServiceAccount, pushStatus } from './push.mjs';

/* KTL's own API, behind the web setup and admin pages:
 *
 *   GET  /api/setup                   is this server set up yet?
 *   POST /api/setup/claim             first run: the owner's account, the
 *                                     household, the address — guarded by
 *                                     the setup code from the server's log
 *   GET  /api/admin                   everything the admin page shows
 *   POST /api/admin/people            add someone: account + set-password link
 *   POST /api/admin/people/:id/link   a fresh set-password link
 *   DELETE /api/admin/people/:id      remove someone and their account
 *   PUT  /api/admin/settings          address, sign-ups, email, tunnel
 *   POST /api/admin/email-test        send the owner a password-reset email
 *   PUT|DELETE /api/admin/push        the Firebase key for push notifications
 *   POST /api/admin/backups           take a backup now
 *   GET  /api/admin/backups/:name     download one
 *   POST /api/account/delete          delete your own account
 *
 * /api/admin/* is for the household's owner only — the person who set the
 * server up — checked from their sign-in token on every request. */

const MAX_BODY = 64 * 1024;
const ATTEMPTS = new Map(); // ip -> { count, until }
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;
const CHECKS = new Map(); // ip -> { count, until }, for password-status
const CHECKS_ALLOWED = 10; // per IP per LOCK_MS
const MAX_PEOPLE = 6;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function codeMatches(given, expected) {
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const a = Buffer.from(norm(given));
  const b = Buffer.from(norm(expected));
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/* "ktl.example.com/anything" → "https://ktl.example.com". */
export function normaliseSiteUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return /^https?:$/.test(url.protocol) && url.hostname ? url.origin : '';
  } catch {
    return '';
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'too_large', 'That’s too much to send at once.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new HttpError(400, 'bad_json', 'The request wasn’t readable.')); }
    });
    req.on('error', reject);
  });
}

let version = null;
function appVersion() {
  if (version === null) {
    try { version = readFileSync(path.join(config.webRoot, 'version.txt'), 'utf8').trim(); } catch { version = ''; }
  }
  return version;
}

export async function serverHouseholdId(db = getPool()) {
  const { rows: [r] } = await db.query("select value from ktl_meta.settings where key = 'household_id'");
  return r?.value || null;
}

/* What a server says about itself (GET /api/config): the app uses it to
   check an address really is a KTL server, and to know what to offer. */
export async function serverInfo() {
  let ready = false;
  try { ready = Boolean(await serverHouseholdId()); } catch { /* database still starting */ }
  return { app: 'ktl', version: appVersion(), ready, email: config.emailEnabled, signup: config.allowSignup };
}

/* Everything tied to an account, then the account itself. Refuses while
   they still share the household — leave or be removed first. */
export async function deleteAccountFully(userId) {
  await getPool().query('select public.delete_user_account($1)', [userId]);
  await gotrueAdmin('DELETE', `/users/${userId}`);
}

async function recoveryLink(email) {
  const link = await gotrueAdmin('POST', '/generate_link', {
    type: 'recovery', email, redirect_to: `${config.siteUrl}/android/home`
  });
  const url = link?.action_link || link?.properties?.action_link;
  if (!url) throw new HttpError(502, 'no_link', 'The sign-in service didn’t return a link.');
  return url;
}

async function requireOwner(req) {
  const claims = verifyJwt(bearer(req), config.jwtSecret);
  if (!claims?.sub) throw new HttpError(401, 'not_signed_in', 'Log in first.');
  const db = getPool();
  const hid = await serverHouseholdId(db);
  if (!hid) throw new HttpError(409, 'not_set_up', 'This server isn’t set up yet.');
  const { rows: [m] } = await db.query(
    'select role from public.household_members where household_id = $1 and user_id = $2', [hid, claims.sub]
  );
  if (m?.role !== 'owner') throw new HttpError(403, 'owner_only', 'Only the person who runs this server can do that.');
  return { userId: claims.sub, email: claims.email, hid };
}

async function overview(hid) {
  const db = getPool();
  const [{ rows: [household] }, { rows: people }] = await Promise.all([
    db.query('select id, name from public.households where id = $1', [hid]),
    db.query(
      `select u.id, u.email, coalesce(p.full_name, '') as name, m.role,
              u.last_sign_in_at as "lastSignIn",
              coalesce(u.encrypted_password, '') <> '' as "hasPassword",
              m.user_id is not null as "inHousehold"
         from auth.users u
         left join public.profiles p on p.id = u.id
         left join public.household_members m on m.user_id = u.id and m.household_id = $1
        order by (m.user_id is not null) desc, (m.role = 'owner') desc nulls last, u.created_at`,
      [hid]
    )
  ]);
  return {
    version: appVersion(),
    siteUrl: config.siteUrl,
    household,
    people,
    maxPeople: MAX_PEOPLE,
    settings: settings.describe(),
    push: pushStatus(),
    backups: listBackups().map((b) => ({ name: b.name, size: b.size }))
  };
}

async function openItemsFor(db, hid, userId) {
  const { rows: [r] } = await db.query(
    `select (
       select count(*) from public.bills b
        where b.household_id = $1 and b.status in ('scheduled','awaiting-details','payment-due')
          and (b.payer_id = $2 or exists (select 1 from public.bill_shares s where s.bill_id = b.id and s.user_id = $2 and s.share > 0))
     ) + (
       select count(*) from public.lending l
        where l.household_id = $1 and l.status in ('scheduled','awaiting-details','payment-due')
          and (l.payer_id = $2 or exists (select 1 from public.lending_shares s where s.lending_id = l.id and s.user_id = $2 and s.share > 0))
     ) as n`,
    [hid, userId]
  );
  return Number(r.n);
}

export function createPortalApi({ clientIp, sendJson, onPushChanged = () => {} }) {
  const handlers = {
    'GET /api/setup': async () => {
      const db = getPool();
      const { rows: [r] } = await db.query('select count(*)::int as n from auth.users');
      return { ready: Boolean(await serverHouseholdId(db)), accounts: r.n, suggestedUrl: settings.get('KTL_SITE_URL') || null };
    },

    'POST /api/setup/claim': async (req) => {
      const ip = clientIp(req);
      const now = Date.now();
      const tries = ATTEMPTS.get(ip);
      if (tries && tries.until > now) throw new HttpError(429, 'locked', 'Too many wrong codes. Try again in 15 minutes.');
      const body = await readJson(req);
      if (!codeMatches(body.code, config.setupCode)) {
        const count = (tries?.until && tries.until <= now ? 0 : tries?.count || 0) + 1;
        ATTEMPTS.set(ip, { count, until: count >= LOCK_AFTER ? now + LOCK_MS : 0 });
        throw new HttpError(403, 'bad_code', 'That setup code isn’t right. It’s in the server’s log: docker logs ktl');
      }
      ATTEMPTS.delete(ip);

      const db = getPool();
      if (await serverHouseholdId(db)) throw new HttpError(409, 'already_set_up', 'This server is already set up. Log in instead.');

      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const householdName = String(body.household || '').trim();
      const siteUrl = body.siteUrl ? normaliseSiteUrl(body.siteUrl) : '';
      if (name.length < 2) throw new HttpError(400, 'bad_name', 'Enter your name.');
      if (!EMAIL.test(email)) throw new HttpError(400, 'bad_email', 'Enter a valid email address.');
      if (password.length < 8) throw new HttpError(400, 'weak_password', 'Use a password of at least 8 characters.');
      if (!householdName) throw new HttpError(400, 'bad_household', 'Give your household a name.');
      if (body.siteUrl && !siteUrl) throw new HttpError(400, 'bad_url', 'That address doesn’t look right — try something like https://ktl.example.com.');

      const user = await gotrueAdmin('POST', '/users', {
        email, password, email_confirm: true, role: 'authenticated', user_metadata: { full_name: name }
      }).catch((err) => {
        throw new HttpError(err.status === 422 ? 409 : 502, 'account_failed',
          err.status === 422 ? 'There’s already an account with that email on this server.' : `Couldn’t create your account: ${err.message}`);
      });

      const client = await db.connect();
      try {
        await client.query('begin');
        const { rows: [h] } = await client.query(
          'insert into public.households (name, created_by) values ($1, $2) returning id', [householdName, user.id]
        );
        await client.query("insert into public.household_members (household_id, user_id, role) values ($1, $2, 'owner')", [h.id, user.id]);
        await client.query('insert into public.household_reminders (household_id) values ($1)', [h.id]);
        await client.query(
          "insert into ktl_meta.settings (key, value) values ('household_id', $1) on conflict (key) do update set value = excluded.value, updated_at = now()",
          [h.id]
        );
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        await gotrueAdmin('DELETE', `/users/${user.id}`).catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      const changed = settings.update({ ...(siteUrl ? { KTL_SITE_URL: siteUrl } : {}), KTL_ALLOW_SIGNUP: 'false' });
      // The next step makes set-password links, which need sign-in to know the new address.
      if (settings.needsRestart(changed)) await settings.waitUntilApplied();
      console.log(`gateway: set up by ${ip} — household "${householdName}"`);
      return { ok: true, siteUrl: config.siteUrl };
    },

    'GET /api/admin': async (req) => {
      const { hid } = await requireOwner(req);
      return overview(hid);
    },

    'POST /api/admin/people': async (req) => {
      const { hid } = await requireOwner(req);
      const body = await readJson(req);
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      if (name.length < 2) throw new HttpError(400, 'bad_name', 'Enter their name.');
      if (!EMAIL.test(email)) throw new HttpError(400, 'bad_email', 'Enter a valid email address.');
      const db = getPool();
      const { rows: [c] } = await db.query('select count(*)::int as n from public.household_members where household_id = $1', [hid]);
      if (c.n >= MAX_PEOPLE) throw new HttpError(409, 'household_full', `A household holds ${MAX_PEOPLE} people, and this one is full.`);

      const user = await gotrueAdmin('POST', '/users', { email, email_confirm: true, role: 'authenticated', user_metadata: { full_name: name } }).catch((err) => {
        throw new HttpError(err.status === 422 ? 409 : 502, 'account_failed',
          err.status === 422 ? 'There’s already an account with that email.' : `Couldn’t create the account: ${err.message}`);
      });
      await db.query(
        "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'member') on conflict do nothing",
        [hid, user.id]
      );
      return { person: { id: user.id, name, email }, link: await recoveryLink(email) };
    },

    'POST /api/admin/people/:id/link': async (req, { id }) => {
      await requireOwner(req);
      const { rows: [u] } = await getPool().query('select email from auth.users where id = $1', [id]);
      if (!u) throw new HttpError(404, 'no_such_person', 'There’s no account like that any more.');
      return { link: await recoveryLink(u.email) };
    },

    'DELETE /api/admin/people/:id': async (req, { id }) => {
      const { userId, hid } = await requireOwner(req);
      if (id === userId) throw new HttpError(400, 'cant_remove_owner', 'You can’t remove yourself — you run this server.');
      const db = getPool();
      const { rows: [m] } = await db.query('select 1 from public.household_members where household_id = $1 and user_id = $2', [hid, id]);
      if (m) {
        if (await openItemsFor(db, hid, id)) {
          throw new HttpError(409, 'has_open_items',
            'They still have open bills or money between them and the household. Remove them from House → Who’s in in the app, which writes those off first.');
        }
        await db.query('delete from public.household_members where household_id = $1 and user_id = $2', [hid, id]);
      }
      // An account left over from before (e.g. a household that predates
      // one-household-per-server) can still be in another household: take
      // it out, and drop any household that leaves empty.
      await db.query('delete from public.household_members where user_id = $1 and household_id <> $2', [id, hid]);
      await db.query(
        'delete from public.households h where h.id <> $1 and not exists (select 1 from public.household_members m where m.household_id = h.id)',
        [hid]
      );
      await deleteAccountFully(id);
      return { removed: true };
    },

    'PUT /api/admin/settings': async (req) => {
      const { hid } = await requireOwner(req);
      const body = await readJson(req);
      const changes = {};
      if ('siteUrl' in body) {
        const url = normaliseSiteUrl(body.siteUrl);
        if (body.siteUrl && !url) throw new HttpError(400, 'bad_url', 'That address doesn’t look right — try something like https://ktl.example.com.');
        changes.KTL_SITE_URL = url;
      }
      if ('signup' in body) changes.KTL_ALLOW_SIGNUP = body.signup ? 'true' : 'false';
      if ('smtpHost' in body) changes.KTL_SMTP_HOST = body.smtpHost;
      if ('smtpPort' in body) {
        if (body.smtpPort && !/^\d{2,5}$/.test(String(body.smtpPort))) throw new HttpError(400, 'bad_port', 'The port should be a number, usually 587 or 465.');
        changes.KTL_SMTP_PORT = body.smtpPort;
      }
      if ('smtpUser' in body) changes.KTL_SMTP_USER = body.smtpUser;
      if ('smtpPass' in body) changes.KTL_SMTP_PASS = body.smtpPass;
      if ('smtpSender' in body) {
        if (body.smtpSender && !EMAIL.test(String(body.smtpSender).trim())) throw new HttpError(400, 'bad_sender', 'The sender should be an email address.');
        changes.KTL_SMTP_SENDER = body.smtpSender;
      }
      if ('smtpSenderName' in body) {
        const name = String(body.smtpSenderName ?? '').replace(/\p{Cc}/gu, '').trim();
        if (name.length > 60) throw new HttpError(400, 'bad_sender_name', 'Keep the sender name under 60 characters.');
        changes.KTL_SMTP_SENDER_NAME = name;
      }
      if ('tunnelToken' in body) changes.CLOUDFLARE_TUNNEL_TOKEN = body.tunnelToken;
      const changed = settings.update(changes);
      if (settings.needsRestart(changed)) await settings.waitUntilApplied();
      return overview(hid);
    },

    'POST /api/admin/email-test': async (req) => {
      const { email } = await requireOwner(req);
      if (!config.emailEnabled) throw new HttpError(409, 'no_email', 'Save the email settings first.');
      const res = await fetch(`${config.gotrue}/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new HttpError(502, 'email_failed', `The email didn’t send: ${detail.msg || detail.message || res.status}. Check the settings — and give the server a few seconds after saving.`);
      }
      return { sent: true, to: email };
    },

    'PUT /api/admin/push': async (req) => {
      const { hid } = await requireOwner(req);
      if (process.env.KTL_FCM_SERVICE_ACCOUNT) throw new HttpError(409, 'set_by_container', 'Push is set by the container’s KTL_FCM_SERVICE_ACCOUNT.');
      const body = await readJson(req);
      const sa = (() => { try { return parseServiceAccount(body.serviceAccount); } catch (err) { throw new HttpError(400, 'bad_key', err.message); } })();
      mkdirSync(path.dirname(config.fcmServiceAccountFile), { recursive: true });
      const tmp = `${config.fcmServiceAccountFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(sa), { mode: 0o600 });
      renameSync(tmp, config.fcmServiceAccountFile);
      onPushChanged();
      return overview(hid);
    },

    'DELETE /api/admin/push': async (req) => {
      const { hid } = await requireOwner(req);
      rmSync(config.fcmServiceAccountFile, { force: true });
      onPushChanged();
      return overview(hid);
    },

    'POST /api/admin/backups': async (req) => {
      const { hid } = await requireOwner(req);
      await runBackup({ label: 'manual' });
      return overview(hid);
    },

    /* After a failed log-in, the app asks whether the account simply has
       no password yet — made from the admin page and its link never used,
       or from before KTL had passwords — so it can say so instead of
       "wrong password". It answers true for nothing else, and is rate
       limited, so it can't be used to list who has an account. */
    'POST /api/account/password-status': async (req) => {
      const ip = clientIp(req);
      const now = Date.now();
      const seen = CHECKS.get(ip);
      const entry = seen && seen.until > now ? seen : { count: 0, until: now + LOCK_MS };
      entry.count += 1;
      CHECKS.set(ip, entry);
      if (entry.count > CHECKS_ALLOWED) throw new HttpError(429, 'over_request_rate_limit', 'Too many tries. Wait a few minutes, then try again.');
      const email = String((await readJson(req)).email || '').trim();
      if (!EMAIL.test(email)) return { needsPassword: false };
      const { rows: [u] } = await getPool().query(
        "select coalesce(encrypted_password, '') = '' as needs from auth.users where lower(email) = lower($1)", [email]
      );
      return { needsPassword: Boolean(u?.needs) };
    },

    'POST /api/account/delete': async (req) => {
      req.resume();
      const claims = verifyJwt(bearer(req), config.jwtSecret);
      if (!claims?.sub || !UUID.test(claims.sub)) throw new HttpError(401, 'not_signed_in', 'Log in first.');
      const { rows: [user] } = await getPool().query('select id from auth.users where id = $1', [claims.sub]);
      if (!user) throw new HttpError(401, 'not_signed_in', 'Log in first.');
      try {
        await deleteAccountFully(user.id);
      } catch (err) {
        if (String(err.message).includes('leave_household_first')) throw new HttpError(409, 'leave_household_first', 'Leave your household first.');
        throw err;
      }
      return { deleted: true };
    }
  };

  async function downloadBackup(req, res, name) {
    await requireOwner(req);
    const backup = listBackups().find((b) => b.name === name);
    if (!backup) throw new HttpError(404, 'no_such_backup', 'That backup isn’t there any more.');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': backup.size,
      'Content-Disposition': `attachment; filename="${backup.name}"`,
      'Cache-Control': 'no-store'
    });
    createReadStream(backup.file).pipe(res);
  }

  return async function handlePortal(req, res, p) {
    try {
      const people = /^\/api\/admin\/people\/([^/]+)(\/link)?$/.exec(p);
      if (people && !UUID.test(people[1])) throw new HttpError(404, 'not_found', 'Not found.');
      const backup = /^\/api\/admin\/backups\/([\w.-]+\.dump)$/.exec(p);
      if (backup && req.method === 'GET') return await downloadBackup(req, res, backup[1]);

      const route = people ? `/api/admin/people/:id${people[2] || ''}` : p;
      const handler = handlers[`${req.method} ${route}`];
      if (!handler) throw new HttpError(404, 'not_found', 'Not found.');
      const result = await handler(req, people ? { id: people[1] } : {});
      return sendJson(req, res, 200, result);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(req, res, err.status, { error: err.code, message: err.message });
      console.error('gateway: portal request failed', req.method, p, err.message);
      return sendJson(req, res, 500, { error: 'internal', message: 'Something went wrong on the server. Its log has the details.' });
    }
  };
}
