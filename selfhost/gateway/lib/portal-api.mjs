import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, openSync, readFileSync, readSync, closeSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config, validTimezone } from './config.mjs';
import * as settings from './settings.mjs';
import { getPool } from './db.mjs';
import { gotrueAdmin } from './gotrue-admin.mjs';
import { bearer, verifyJwt } from './jwt.mjs';
import { listBackups, localDate, runBackup } from './backup.mjs';
import { probeHealth } from './health.mjs';
import { createInvite, findInvite, inviteMessage, inviteState, openInvites, tokenFrom, DEFAULT_TTL } from './invites.mjs';
import { parseServiceAccount, pushStatus } from './push.mjs';
import { requestRestart, restoreBackup } from './restore.mjs';
import { updateStatus } from './updates.mjs';
import { findDeals, kindFromName, PROVIDERS, testProvider } from './ai.mjs';

/* KTL's own API, behind the web setup and admin pages:
 *
 *   GET  /api/setup                    is this server set up yet?
 *   POST /api/setup/claim              first run: the owner's account, the
 *                                      household, the address — guarded by
 *                                      the setup code from the server's log
 *   GET  /api/admin                    everything the admin page shows
 *   PUT  /api/admin/household          name, how you use KTL, reminder times
 *   POST /api/admin/people             add someone: account + invite
 *   PATCH /api/admin/people/:id        change their name, email or password
 *   POST /api/admin/people/:id/invite  a new invite (cancels the old one)
 *   POST /api/admin/people/:id/link    a one-hour password-reset link
 *   POST /api/admin/people/:id/owner   hand the server over to them
 *   DELETE /api/admin/people/:id       remove someone and their account
 *   PUT  /api/admin/settings           address, sign-ups, email, tunnel,
 *                                      proxy, backup schedule
 *   POST /api/admin/test-address       does this address reach this server?
 *   POST /api/admin/email-test         send the owner a password-reset email
 *   PUT|DELETE /api/admin/push         the Firebase key for push notifications
 *   POST /api/admin/backups            take a backup now
 *   POST /api/admin/backups/upload     add a backup file (the request body)
 *   GET  /api/admin/backups/:name      download one
 *   POST /api/admin/restore            replace everything with a backup
 *   POST /api/invite/check             what an invite is for, if it's valid
 *   POST /api/invite/redeem            use an invite to choose a password
 *   POST /api/account/password-status  does this account have no password yet?
 *   POST /api/account/delete           delete your own account
 *   POST /api/deals/check              start an AI search for a better deal
 *   GET  /api/deals/check/:id          how that search is getting on
 *   POST /api/admin/ai-test            does the saved AI key work?
 *
 * /api/admin/* is for the household's owner only — the person who set the
 * server up — checked from their sign-in token on every request. */

const MAX_BODY = 64 * 1024;
const MAX_UPLOAD = 500 * 1024 * 1024;
const INVITE_TRIES = new Map(); // ip -> { count, until }, for /api/invite/*
const DEAL_CHECKS = new Map(); // user id -> { count, until }: deal checks spend the owner's AI credit
const DEAL_CHECKS_PER_DAY = 10;
const DEAL_JOBS = new Map(); // job id -> { userId, status, value | error, expires }
const AI_ERROR_STATUS = { ai_off: 409, ai_bad_key: 502, ai_rate_limited: 429, ai_refused: 422, ai_timeout: 504, ai_failed: 502 };
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
  // push: whether this server can send push, so the app only asks for
  // notification permission and registers when it's worth it.
  return { app: 'ktl', version: appVersion(), ready, email: config.emailEnabled, signup: config.allowSignup, push: pushStatus().configured, ai: config.aiEnabled };
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
  const [{ rows: [household] }, { rows: [reminders] }, { rows: people }, invites, health, update] = await Promise.all([
    db.query('select id, name, mode, payout_ref as "payoutRef" from public.households where id = $1', [hid]),
    db.query(
      `select details_lead as "detailsLead", to_char(details_time, 'HH24:MI') as "detailsTime",
              payment_lead as "paymentLead", to_char(payment_time, 'HH24:MI') as "paymentTime",
              nudge_after as "nudgeAfter", to_char(quiet_from, 'HH24:MI') as "quietFrom",
              to_char(quiet_to, 'HH24:MI') as "quietTo", weekly_digest as "weeklyDigest"
         from public.household_reminders where household_id = $1`, [hid]
    ),
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
    ),
    openInvites(db).catch(() => ({})),
    probeHealth(),
    updateStatus(appVersion()).catch(() => null)
  ]);
  const backups = listBackups().map((b) => ({ name: b.name, size: b.size, mtime: b.mtime }));
  return {
    version: appVersion(),
    siteUrl: config.siteUrl,
    household: { ...household, reminders: reminders || null },
    people: people.map((p) => ({ ...p, inviteExpiresAt: invites[p.id] || null })),
    maxPeople: MAX_PEOPLE,
    settings: settings.describe(),
    schedule: { hour: config.backupHour, keep: config.backupKeep, timezone: config.timezone },
    push: pushStatus(),
    health,
    update,
    ai: { providers: PROVIDERS, enabled: config.aiEnabled },
    backups
  };
}

/* The household's owner, by name, for invite messages. */
async function ownerName(db, hid) {
  const { rows: [r] } = await db.query(
    `select coalesce(p.full_name, '') as name, h.name as household
       from public.households h
       left join public.household_members m on m.household_id = h.id and m.role = 'owner'
       left join public.profiles p on p.id = m.user_id
      where h.id = $1 limit 1`, [hid]
  );
  return { owner: r?.name || '', household: r?.household || '' };
}

async function makeInvite(db, { hid, userId, createdBy, expiresIn }) {
  try {
    const { token, expiresAt } = await createInvite(db, { userId, createdBy, expiresIn: expiresIn || DEFAULT_TTL });
    const link = `${config.siteUrl}/join#${token}`;
    const { owner, household } = await ownerName(db, hid);
    return { link, expiresAt, message: inviteMessage({ owner, household, link, expiresAt, timeZone: config.timezone }) };
  } catch (err) {
    if (err.code === 'bad_expiry') throw new HttpError(400, err.code, err.message);
    throw err;
  }
}

/* Limits guesses at invite tokens and account lookups: `allowed` per IP
   per 15 minutes. */
function rateLimit(map, ip, allowed) {
  const now = Date.now();
  const seen = map.get(ip);
  const entry = seen && seen.until > now ? seen : { count: 0, until: now + LOCK_MS };
  entry.count += 1;
  map.set(ip, entry);
  if (entry.count > allowed) throw new HttpError(429, 'over_request_rate_limit', 'Too many tries. Wait a few minutes, then try again.');
}

/* Streams an uploaded backup into the backups folder, checking it's a
   Postgres dump (they start with "PGDMP") and not too big. */
function receiveBackup(req) {
  return new Promise((resolve, reject) => {
    mkdirSync(config.backupDir, { recursive: true });
    const time = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    const name = `ktl-${localDate()}-uploaded-${time}.dump`;
    const file = path.join(config.backupDir, name);
    const tmp = `${file}.partial`;
    const out = createWriteStream(tmp, { mode: 0o640 });
    let size = 0;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      out.destroy();
      rmSync(tmp, { force: true });
      req.resume();
      reject(err);
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD) fail(new HttpError(413, 'too_large', 'That backup is bigger than 500 MB.'));
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (failed) return;
      let head = Buffer.alloc(5);
      try {
        const fd = openSync(tmp, 'r');
        readSync(fd, head, 0, 5, 0);
        closeSync(fd);
      } catch { head = Buffer.alloc(0); }
      if (head.toString('latin1') !== 'PGDMP') {
        rmSync(tmp, { force: true });
        return reject(new HttpError(400, 'not_a_backup', 'That isn’t a KTL backup — use a .dump file from the backups list or /data/backups.'));
      }
      renameSync(tmp, file);
      resolve(name);
    });
    req.pipe(out);
  });
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
      const { hid, userId: ownerId } = await requireOwner(req);
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
      const invite = await makeInvite(db, { hid, userId: user.id, createdBy: ownerId, expiresIn: body.expiresIn });
      return { person: { id: user.id, name, email }, invite };
    },

    'POST /api/admin/people/:id/invite': async (req, { id }) => {
      const { hid, userId: ownerId } = await requireOwner(req);
      const body = await readJson(req);
      const db = getPool();
      const { rows: [u] } = await db.query('select id from auth.users where id = $1', [id]);
      if (!u) throw new HttpError(404, 'no_such_person', 'There’s no account like that any more.');
      return { invite: await makeInvite(db, { hid, userId: id, createdBy: ownerId, expiresIn: body.expiresIn }) };
    },

    'PATCH /api/admin/people/:id': async (req, { id }) => {
      const { hid } = await requireOwner(req);
      const body = await readJson(req);
      const db = getPool();
      const { rows: [u] } = await db.query('select id, email from auth.users where id = $1', [id]);
      if (!u) throw new HttpError(404, 'no_such_person', 'There’s no account like that any more.');
      const change = {};
      if ('email' in body) {
        const email = String(body.email || '').trim().toLowerCase();
        if (!EMAIL.test(email)) throw new HttpError(400, 'bad_email', 'Enter a valid email address.');
        if (email !== u.email) { change.email = email; change.email_confirm = true; }
      }
      if ('password' in body) {
        const password = String(body.password || '');
        if (password.length < 8) throw new HttpError(400, 'weak_password', 'Use a password of at least 8 characters.');
        change.password = password;
      }
      if ('name' in body) {
        const name = String(body.name || '').replace(/\p{Cc}/gu, '').trim();
        if (name.length < 2 || name.length > 60) throw new HttpError(400, 'bad_name', 'Enter a name between 2 and 60 characters.');
        await db.query('update public.profiles set full_name = $2 where id = $1', [id, name]);
      }
      if (Object.keys(change).length) {
        await gotrueAdmin('PUT', `/users/${id}`, change).catch((err) => {
          throw new HttpError(err.status === 422 ? 409 : 502, 'update_failed',
            err.status === 422 ? 'Another account already uses that email.' : `Couldn’t save that: ${err.message}`);
        });
      }
      return overview(hid);
    },

    /* Hands the server over: they become the owner (and can use this
       page); you stay in the household as a member. */
    'POST /api/admin/people/:id/owner': async (req, { id }) => {
      const { hid, userId } = await requireOwner(req);
      if (id === userId) throw new HttpError(400, 'already_owner', 'You already run this server.');
      const client = await getPool().connect();
      try {
        await client.query('begin');
        const { rowCount } = await client.query(
          "update public.household_members set role = 'owner' where household_id = $1 and user_id = $2", [hid, id]
        );
        if (!rowCount) throw new HttpError(404, 'not_in_household', 'They need to be in the household first.');
        await client.query(
          "update public.household_members set role = 'member' where household_id = $1 and user_id = $2", [hid, userId]
        );
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      return { handedOver: true };
    },

    'PUT /api/admin/household': async (req) => {
      const { hid } = await requireOwner(req);
      const body = await readJson(req);
      const client = await getPool().connect();
      try {
        await client.query('begin');
        if ('name' in body) {
          const name = String(body.name || '').replace(/\p{Cc}/gu, '').trim();
          if (!name || name.length > 60) throw new HttpError(400, 'bad_household', 'Give your household a name (up to 60 characters).');
          await client.query('update public.households set name = $2 where id = $1', [hid, name]);
        }
        if ('payoutRef' in body) {
          const ref = String(body.payoutRef || '').replace(/\p{Cc}/gu, '').trim();
          if (ref.length > 18) throw new HttpError(400, 'bad_reference', 'Keep the reference to 18 characters — the most UK banks allow.');
          await client.query('update public.households set payout_ref = $2 where id = $1', [hid, ref || null]);
        }
        if ('mode' in body) {
          if (!['chase', 'track'].includes(body.mode)) throw new HttpError(400, 'bad_mode', 'Choose chase-and-confirm or tracking only.');
          await client.query('update public.households set mode = $2 where id = $1', [hid, body.mode]);
          // As in the app: in tracking only, saying you've paid closes the
          // line, so anything already marked sent is settled.
          if (body.mode === 'track') {
            await client.query("update public.bills set status = 'settled' where household_id = $1 and status = 'sent'", [hid]);
            await client.query("update public.lending set status = 'settled' where household_id = $1 and status = 'sent'", [hid]);
          }
        }
        if (body.reminders && typeof body.reminders === 'object') {
          const r = body.reminders;
          const lead = (v, max) => {
            const n = Number(v);
            if (!Number.isInteger(n) || n < 0 || n > max) throw new HttpError(400, 'bad_reminder', `Reminders can be 0 to ${max} days ahead.`);
            return n;
          };
          const time = (v) => {
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) throw new HttpError(400, 'bad_reminder', 'Times look like 09:00.');
            return String(v);
          };
          const cols = [];
          const vals = [hid];
          if ('detailsLead' in r) { vals.push(lead(r.detailsLead, 28)); cols.push(`details_lead = $${vals.length}`); }
          if ('detailsTime' in r) { vals.push(time(r.detailsTime)); cols.push(`details_time = $${vals.length}`); }
          if ('paymentLead' in r) { vals.push(lead(r.paymentLead, 28)); cols.push(`payment_lead = $${vals.length}`); }
          if ('paymentTime' in r) { vals.push(time(r.paymentTime)); cols.push(`payment_time = ${vals.length}`); }
          if ('nudgeAfter' in r) {
            const n = Number(r.nudgeAfter);
            if (!Number.isInteger(n) || n < 0 || n > 168) throw new HttpError(400, 'bad_reminder', 'Nudge after 0 (off) to 168 hours.');
            vals.push(n); cols.push(`nudge_after = ${vals.length}`);
          }
          if ('quietFrom' in r) { vals.push(time(r.quietFrom)); cols.push(`quiet_from = ${vals.length}`); }
          if ('quietTo' in r) { vals.push(time(r.quietTo)); cols.push(`quiet_to = ${vals.length}`); }
          if ('weeklyDigest' in r) { vals.push(Boolean(r.weeklyDigest)); cols.push(`weekly_digest = ${vals.length}`); }
          if (cols.length) await client.query(`update public.household_reminders set ${cols.join(', ')} where household_id = $1`, vals);
        }
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      return overview(hid);
    },

    /* Does this address reach this server? Asked from the server itself,
       so it tests what the outside world (or the tunnel) sees. */
    'POST /api/admin/test-address': async (req) => {
      await requireOwner(req);
      const url = normaliseSiteUrl((await readJson(req)).url);
      if (!url) throw new HttpError(400, 'bad_url', 'That address doesn’t look right — try something like https://ktl.example.com.');
      try {
        const res = await fetch(`${url}/api/config`, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
        const info = await res.json().catch(() => null);
        if (!res.ok || info?.app !== 'ktl') return { ok: false, url, message: `Something answered at ${url}, but it isn’t this KTL server.` };
        return { ok: true, url, message: `${url} reaches this KTL server.` };
      } catch (err) {
        return { ok: false, url, message: `Couldn’t reach ${url} from the server (${err.name === 'TimeoutError' ? 'it took too long' : err.cause?.code || err.message}).` };
      }
    },

    'POST /api/admin/backups/upload': async (req) => {
      const { hid } = await requireOwner(req);
      const name = await receiveBackup(req);
      return { ...(await overview(hid)), uploaded: name };
    },

    /* Replaces everything with one of the backups. The browser asks for
       "REPLACE" to be typed first; the server checks it too. */
    'POST /api/admin/restore': async (req) => {
      await requireOwner(req);
      const body = await readJson(req);
      if (body.confirm !== 'REPLACE') throw new HttpError(400, 'not_confirmed', 'Type REPLACE to confirm.');
      const backup = listBackups().find((b) => b.name === body.name);
      if (!backup) throw new HttpError(404, 'no_such_backup', 'That backup isn’t there any more.');
      let safety = '';
      try {
        await restoreBackup(backup.file, { onSafetyCopy: (f) => { safety = path.basename(f); } });
      } catch (err) {
        if (err.code === 'restore_running') throw new HttpError(409, err.code, err.message);
        if (err.code === 'restore_failed') throw new HttpError(500, err.code, `${err.message} The current data is untouched.`);
        throw err;
      }
      requestRestart();
      console.log(`gateway: restored ${backup.name} (current data saved as ${safety})`);
      return { restored: backup.name, safetyCopy: safety };
    },

    'POST /api/invite/check': async (req) => {
      rateLimit(INVITE_TRIES, clientIp(req), 20);
      const token = tokenFrom((await readJson(req)).token);
      const db = getPool();
      const row = await findInvite(db, token);
      const state = inviteState(row);
      if (state !== 'valid') return { valid: false, state };
      const hid = await serverHouseholdId(db);
      const { owner, household } = await ownerName(db, hid);
      return { valid: true, state, email: row.email, name: row.name, household, owner, expiresAt: row.expires_at };
    },

    'POST /api/invite/redeem': async (req) => {
      rateLimit(INVITE_TRIES, clientIp(req), 20);
      const body = await readJson(req);
      const token = tokenFrom(body.token);
      const password = String(body.password || '');
      if (password.length < 8) throw new HttpError(400, 'weak_password', 'Use a password of at least 8 characters.');
      const db = getPool();
      const row = await findInvite(db, token);
      const state = inviteState(row);
      if (state !== 'valid') {
        throw new HttpError(410, `invite_${state}`, state === 'used'
          ? 'This invite has already been used. If that wasn’t you, tell whoever runs this server.'
          : 'This invite has run out. Ask whoever runs this server for a new one.');
      }
      const client = await db.connect();
      try {
        await client.query('begin');
        // Claim it first, so two people racing with the same link can't both use it.
        const { rowCount } = await client.query(
          'update ktl_meta.invites set used_at = now() where id = $1 and used_at is null and cancelled_at is null and expires_at > now()', [row.id]
        );
        if (!rowCount) throw new HttpError(410, 'invite_used', 'This invite has already been used.');
        await gotrueAdmin('PUT', `/users/${row.user_id}`, { password });
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        if (err instanceof HttpError) throw err;
        throw new HttpError(502, 'redeem_failed', `Couldn’t set your password: ${err.message}`);
      } finally {
        client.release();
      }
      return { ok: true, email: row.email };
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
      if ('trustProxy' in body) changes.KTL_TRUST_PROXY = body.trustProxy ? 'true' : 'false';
      if ('backupHour' in body) {
        const h = Number(body.backupHour);
        if (!Number.isInteger(h) || h < 0 || h > 23) throw new HttpError(400, 'bad_hour', 'Choose an hour from 0 to 23.');
        changes.KTL_BACKUP_HOUR = String(h);
      }
      if ('backupKeep' in body) {
        const n = Number(body.backupKeep);
        if (!Number.isInteger(n) || n < 0 || n > 365) throw new HttpError(400, 'bad_keep', 'Keep between 0 (nightly backups off) and 365.');
        changes.KTL_BACKUP_KEEP = String(n);
      }
      if ('aiProvider' in body) {
        const p = String(body.aiProvider || '');
        if (p && !PROVIDERS[p]) throw new HttpError(400, 'bad_provider', 'Choose Claude, OpenAI or Gemini.');
        changes.KTL_AI_PROVIDER = p;
      }
      if ('aiModel' in body) {
        const m = String(body.aiModel || '').trim();
        if (m && !/^[\w.:/-]{1,80}$/.test(m)) throw new HttpError(400, 'bad_model', 'That doesn’t look like a model name.');
        changes.KTL_AI_MODEL = m;
      }
      if ('aiApiKey' in body) changes.KTL_AI_API_KEY = String(body.aiApiKey || '').trim();
      if ('timezone' in body) {
        const tz = String(body.timezone || '').trim();
        if (tz && !validTimezone(tz)) throw new HttpError(400, 'bad_timezone', 'That isn’t a time zone — try something like Europe/London.');
        changes.KTL_TIMEZONE = tz;
      }
      const changed = settings.update(changes);
      if (settings.needsRestart(changed)) await settings.waitUntilApplied();
      return overview(hid);
    },

    'POST /api/admin/ai-test': async (req) => {
      await requireOwner(req);
      try {
        return await testProvider({ provider: config.aiProvider, apiKey: settings.get('KTL_AI_API_KEY'), model: settings.get('KTL_AI_MODEL') });
      } catch (err) {
        throw new HttpError(AI_ERROR_STATUS[err.code] || 502, err.code || 'ai_failed', err.message);
      }
    },

    /* Asks the AI provider to look for a better deal on one bill. Anyone in
       the household can, on a shared bill (the result is kept for them all)
       or on their own personal bill (the result is only returned, never
       stored). Ten a day each, since it spends the owner's AI credit. */
    /* A search takes anything up to a couple of minutes — longer than a
       tunnel or proxy keeps a request open — so it runs here in the
       background and the app asks for the answer every few seconds. */
    'POST /api/deals/check': async (req) => {
      const claims = verifyJwt(bearer(req), config.jwtSecret);
      if (!claims?.sub || !UUID.test(claims.sub)) throw new HttpError(401, 'not_signed_in', 'Log in first.');
      if (!config.aiEnabled) throw new HttpError(409, 'ai_off', 'Whoever runs this server hasn’t set up an AI provider.');
      const body = await readJson(req);
      const typed = String(body.area || '').trim();
      const area = /^[A-Za-z]{1,2}\d[A-Za-z\d]?$/.test(typed) ? typed.toUpperCase() : '';
      const db = getPool();
      const hid = await serverHouseholdId(db);
      const { rows: [member] } = await db.query('select 1 from public.household_members where household_id = $1 and user_id = $2', [hid, claims.sub]);
      if (!member) throw new HttpError(403, 'not_in_household', 'Only people in the household can do that.');

      let bill;
      let shared = false;
      if (body.billId && UUID.test(String(body.billId))) {
        const { rows: [b] } = await db.query(
          'select id, name, provider, glyph, total, frequency_unit, renews_on::text as renews_on, renewal_kind from public.bills where id = $1 and household_id = $2',
          [body.billId, hid]
        );
        if (!b) throw new HttpError(404, 'no_such_bill', 'That bill isn’t there any more.');
        bill = { kind: b.renewal_kind || kindFromName(b.name, b.glyph), name: b.name, provider: b.provider, amount: Number(b.total), frequencyUnit: b.frequency_unit, renewsOn: b.renews_on };
        shared = true;
      } else if (body.personalBillId && UUID.test(String(body.personalBillId))) {
        const { rows: [b] } = await db.query(
          'select id, name, glyph, amount, renews_on::text as renews_on, renewal_kind from public.personal_bills where id = $1 and user_id = $2',
          [body.personalBillId, claims.sub]
        );
        if (!b) throw new HttpError(404, 'no_such_bill', 'That bill isn’t there any more.');
        bill = { kind: b.renewal_kind || kindFromName(b.name, b.glyph), name: b.name, provider: null, amount: Number(b.amount), frequencyUnit: 'month', renewsOn: b.renews_on };
      } else {
        throw new HttpError(400, 'no_bill', 'Which bill?');
      }

      const now = Date.now();
      for (const [id, job] of DEAL_JOBS) if (job.expires < now) DEAL_JOBS.delete(id);
      if ([...DEAL_JOBS.values()].some((j) => j.userId === claims.sub && j.status === 'running')) {
        throw new HttpError(409, 'already_checking', 'You already have a deal check running — give it a minute.');
      }
      const seen = DEAL_CHECKS.get(claims.sub);
      const entry = seen && seen.until > now ? seen : { count: 0, until: now + 24 * 60 * 60 * 1000 };
      if (entry.count >= DEAL_CHECKS_PER_DAY) throw new HttpError(429, 'over_daily_limit', `That’s ${DEAL_CHECKS_PER_DAY} deal checks today — try again tomorrow.`);
      entry.count += 1;
      DEAL_CHECKS.set(claims.sub, entry);

      const provider = config.aiProvider;
      const model = settings.get('KTL_AI_MODEL') || PROVIDERS[provider].model;
      const jobId = randomUUID();
      const job = { userId: claims.sub, status: 'running', expires: now + 15 * 60 * 1000 };
      DEAL_JOBS.set(jobId, job);
      (async () => {
        try {
          const result = await findDeals({ provider, apiKey: settings.get('KTL_AI_API_KEY'), model, bill, area, timeZone: config.timezone });
          const checkedAt = new Date().toISOString();
          if (shared) {
            await db.query(
              'insert into public.deal_checks (household_id, bill_id, checked_by, checked_at, provider, model, result) values ($1, $2, $3, $4, $5, $6, $7)',
              [hid, body.billId, claims.sub, checkedAt, provider, model, JSON.stringify(result)]
            );
            await db.query(
              'delete from public.deal_checks where bill_id = $1 and id not in (select id from public.deal_checks where bill_id = $1 order by checked_at desc limit 5)',
              [body.billId]
            );
          }
          Object.assign(job, { status: 'done', value: { result, checkedAt, provider: PROVIDERS[provider].label, model, kept: shared, left: DEAL_CHECKS_PER_DAY - entry.count } });
        } catch (err) {
          entry.count = Math.max(0, entry.count - 1); // a failed search doesn't count
          if (!err.code) console.error('gateway: deal check failed', err.message);
          Object.assign(job, { status: 'failed', error: err.code || 'ai_failed', message: err.code ? err.message : 'The search didn’t work. Try again in a moment.' });
        }
      })();
      return { job: jobId, status: 'running' };
    },

    'GET /api/deals/check/:id': async (req, { id }) => {
      const claims = verifyJwt(bearer(req), config.jwtSecret);
      if (!claims?.sub) throw new HttpError(401, 'not_signed_in', 'Log in first.');
      const job = DEAL_JOBS.get(id);
      // Someone else's job looks the same as one that never existed.
      if (!job || job.userId !== claims.sub) throw new HttpError(404, 'no_such_check', 'That check has finished or expired. Start a new one.');
      if (job.status === 'running') return { status: 'running' };
      DEAL_JOBS.delete(id);
      if (job.status === 'failed') throw new HttpError(AI_ERROR_STATUS[job.error] || 502, job.error, job.message);
      return { status: 'done', ...job.value };
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
      const people = /^\/api\/admin\/people\/([^/]+)(\/link|\/invite|\/owner)?$/.exec(p);
      if (people && !UUID.test(people[1])) throw new HttpError(404, 'not_found', 'Not found.');
      const deal = /^\/api\/deals\/check\/([^/]+)$/.exec(p);
      if (deal && !UUID.test(deal[1])) throw new HttpError(404, 'no_such_check', 'That check has finished or expired. Start a new one.');
      const backup = /^\/api\/admin\/backups\/([\w.-]+\.dump)$/.exec(p);
      if (backup && req.method === 'GET') return await downloadBackup(req, res, backup[1]);

      const route = people ? `/api/admin/people/:id${people[2] || ''}` : deal ? '/api/deals/check/:id' : p;
      const handler = handlers[`${req.method} ${route}`];
      if (!handler) throw new HttpError(404, 'not_found', 'Not found.');
      const result = await handler(req, people ? { id: people[1] } : deal ? { id: deal[1] } : {});
      return sendJson(req, res, 200, result);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(req, res, err.status, { error: err.code, message: err.message });
      console.error('gateway: portal request failed', req.method, p, err.message);
      return sendJson(req, res, 500, { error: 'internal', message: 'Something went wrong on the server. Its log has the details.' });
    }
  };
}
