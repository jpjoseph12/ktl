import { createHash, randomBytes } from 'node:crypto';

/* Invites: a one-time link that lets someone the owner added choose their
   password, from the app or a browser. Only the token's hash is stored;
   the token itself exists in the link alone. */

export const INVITE_TTL = { '1h': 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000 };
export const DEFAULT_TTL = '24h';

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

/* 32 random bytes, URL-safe: nothing to guess. */
export const newToken = () => randomBytes(32).toString('base64url');

/* A token as it can arrive: just the token, the link, or the link pasted
   with the message around it. */
export function tokenFrom(input) {
  const s = String(input || '').trim();
  const m = /#([A-Za-z0-9_-]{40,})/.exec(s) || /^([A-Za-z0-9_-]{40,})$/.exec(s);
  return m ? m[1] : '';
}

export function inviteState(row, now = Date.now()) {
  if (!row) return 'missing';
  if (row.used_at) return 'used';
  if (row.cancelled_at) return 'cancelled';
  if (new Date(row.expires_at).getTime() <= now) return 'expired';
  return 'valid';
}

/* Makes a new invite for someone, cancelling any they had before. */
export async function createInvite(db, { userId, createdBy, expiresIn = DEFAULT_TTL, now = Date.now() }) {
  const ttl = INVITE_TTL[expiresIn];
  if (!ttl) throw Object.assign(new Error('Choose how long the invite lasts: 1 hour, 24 hours or 7 days.'), { status: 400, code: 'bad_expiry' });
  const token = newToken();
  const expiresAt = new Date(now + ttl);
  await db.query(
    'update ktl_meta.invites set cancelled_at = now() where user_id = $1 and used_at is null and cancelled_at is null', [userId]
  );
  await db.query(
    'insert into ktl_meta.invites (user_id, token_hash, expires_at, created_by) values ($1, $2, $3, $4)',
    [userId, hashToken(token), expiresAt, createdBy || null]
  );
  return { token, expiresAt };
}

export async function findInvite(db, token) {
  if (!token) return null;
  const { rows: [row] } = await db.query(
    `select i.id, i.user_id, i.expires_at, i.used_at, i.cancelled_at, u.email, coalesce(p.full_name, '') as name
       from ktl_meta.invites i
       join auth.users u on u.id = i.user_id
       left join public.profiles p on p.id = u.id
      where i.token_hash = $1`,
    [hashToken(token)]
  );
  return row || null;
}

/* When each person's current invite runs out (for the admin page). */
export async function openInvites(db) {
  const { rows } = await db.query(
    `select user_id, max(expires_at) as expires_at from ktl_meta.invites
      where used_at is null and cancelled_at is null and expires_at > now()
      group by user_id`
  );
  return Object.fromEntries(rows.map((r) => [r.user_id, r.expires_at]));
}

export function formatExpiry(expiresAt, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(expiresAt));
  } catch {
    return new Date(expiresAt).toISOString();
  }
}

/* The message the owner sends. */
export function inviteMessage({ owner, household, link, expiresAt, timeZone }) {
  const from = owner ? `${owner} has invited you` : 'You’re invited';
  return `${from} to ${household || 'their household'} on KTL, for sharing the household bills.\n\n`
    + `Open this link on your phone or computer to choose your password — it works once, until ${formatExpiry(expiresAt, timeZone)}:\n${link}`;
}
