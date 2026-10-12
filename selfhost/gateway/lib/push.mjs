import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { config } from './config.mjs';
import { getPool } from './db.mjs';

/* Push notifications: when someone does something, tell the other people
   in the household's phones through Firebase Cloud Messaging. Optional —
   it needs a Firebase project, whose service-account key the owner uploads
   on the admin page (or sets in KTL_FCM_SERVICE_ACCOUNT). Only the
   notification itself goes to Google; it's built from the database, never
   from anything a client sent. */

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/* A Firebase service-account key, or a reason it isn't one. */
export function parseServiceAccount(raw) {
  let sa;
  try { sa = JSON.parse(String(raw || '')); } catch { throw new Error('That isn’t valid JSON. Download the key again from Firebase.'); }
  if (sa?.type !== 'service_account' || !sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error('That isn’t a service-account key. In Firebase: Project settings → Service accounts → Generate new private key.');
  }
  return sa;
}

export function loadServiceAccount() {
  const raw = process.env.KTL_FCM_SERVICE_ACCOUNT
    || (existsSync(config.fcmServiceAccountFile) ? readFileSync(config.fcmServiceAccountFile, 'utf8') : '');
  if (!raw.trim()) return null;
  try {
    return parseServiceAccount(raw);
  } catch (err) {
    console.error('gateway: push is off —', err.message);
    return null;
  }
}

/* What the admin page shows about push. */
export function pushStatus() {
  const sa = loadServiceAccount();
  return { configured: Boolean(sa), projectId: sa?.project_id || null, fromContainer: Boolean(process.env.KTL_FCM_SERVICE_ACCOUNT) };
}

let cachedToken = null;
async function accessToken(sa) {
  // Keyed by account, so uploading a different project's key never reuses the old token.
  if (cachedToken && cachedToken.email === sa.client_email && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: sa.client_email, scope: FCM_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` })
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  cachedToken = { email: sa.client_email, value: json.access_token, expires: Date.now() + (json.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

export function createPushSender() {
  const sa = loadServiceAccount();
  if (!sa) {
    console.log('gateway: push notifications off (no Firebase service account)');
    return null;
  }
  console.log(`gateway: push notifications on (Firebase project ${sa.project_id})`);
  const db = getPool();

  return async function sendForActivity(event) {
    const { rows: [row] } = await db.query(
      'select id, household_id, user_id, text from public.activity where id = $1', [event.id]
    );
    if (!row?.household_id || !row?.user_id) return;

    const { rows: tokens } = await db.query(
      `select d.token from public.device_tokens d
         join public.household_members m on m.user_id = d.user_id
        where m.household_id = $1 and m.user_id <> $2`,
      [row.household_id, row.user_id]
    );
    if (!tokens.length) return;

    const { rows: [names] } = await db.query(
      `select (select full_name from public.profiles where id = $1) as actor,
              (select name from public.households where id = $2) as household`,
      [row.user_id, row.household_id]
    );
    const householdName = names?.household || 'Your household';
    const title = names?.actor ? `${names.actor} · ${householdName}` : householdName;

    const bearer = await accessToken(sa);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
    const dead = [];
    for (const { token } of tokens) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body: row.text },
            data: { activityId: String(row.id), householdId: String(row.household_id) },
            android: { priority: 'HIGH', notification: { channel_id: 'ktl-reminders' } }
          }
        })
      });
      // An uninstalled app or rotated token: stop pushing into the void.
      if (res.status === 404 || res.status === 400) dead.push(token);
    }
    if (dead.length) await db.query('delete from public.device_tokens where token = any($1)', [dead]);
  };
}
