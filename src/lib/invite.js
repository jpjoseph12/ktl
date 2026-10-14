import { normaliseServerUrl } from './api';

/* Invites: the owner sends a message with a link to a server's /join page;
   the token after the # works once and runs out. In the Android app the
   same invite arrives as ktl://join?server=<address>#<token>, or pasted
   into the Connect screen. Until it's used, a pending invite is kept here
   so it survives the app switching server and restarting. */

const KEY = 'ktl.invite';
const TOKEN = /[A-Za-z0-9_-]{40,}/;

/* { server, token } from a link, or a whole message with a link in it. */
export function parseInvite(text) {
  const s = String(text || '');
  const app = /ktl:\/\/join\?server=([^#\s]+)#([A-Za-z0-9_-]{40,})/.exec(s);
  if (app) {
    const server = normaliseServerUrl(decodeURIComponent(app[1]));
    return server ? { server, token: app[2] } : null;
  }
  const web = /(https?:\/\/[^\s/#]+)\/join#([A-Za-z0-9_-]{40,})/.exec(s);
  if (web) {
    const server = normaliseServerUrl(web[1]);
    return server ? { server, token: web[2] } : null;
  }
  return null;
}

export function tokenFromHash(hash) {
  const m = TOKEN.exec(String(hash || '').replace(/^#/, ''));
  return m ? m[0] : '';
}

/* The link the /join page offers to open the invite in the app. */
export function appInviteLink(server, token) {
  return `ktl://join?server=${encodeURIComponent(server)}#${token}`;
}

export function sameServer(a, b) {
  return Boolean(a && b) && normaliseServerUrl(a) === normaliseServerUrl(b);
}

export function readPendingInvite() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v?.server && v?.token ? v : null;
  } catch {
    return null;
  }
}

export function savePendingInvite(invite) {
  try { localStorage.setItem(KEY, JSON.stringify({ server: invite.server, token: invite.token })); } catch { /* storage unavailable */ }
}

/* Invites already used or dismissed on this device: a cold start can hand
   the app the same ktl://join launch link again, and it shouldn't come
   back from the dead. */
const DONE_KEY = 'ktl.invite.done';
function doneTokens() {
  try { return JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); } catch { return []; }
}
export function inviteDone(token) {
  return doneTokens().includes(token);
}

export function clearPendingInvite() {
  try {
    const pending = readPendingInvite();
    if (pending) localStorage.setItem(DONE_KEY, JSON.stringify([...doneTokens(), pending.token].slice(-10)));
    localStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
}

/* What an invite is for, asked of the server it belongs to. */
export async function checkInvite(server, token) {
  const res = await fetch(`${server}/api/invite/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || 'Couldn’t check the invite. Try again.'), { status: res.status, code: json.error });
  return json;
}

export async function redeemInvite(server, token, password) {
  const res = await fetch(`${server}/api/invite/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || 'Couldn’t use the invite. Try again.'), { status: res.status, code: json.error });
  return json;
}
