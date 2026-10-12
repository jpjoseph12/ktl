import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

/* The one way the app talks to a KTL server.

   A KTL server runs GoTrue (accounts) and PostgREST (data) behind its
   gateway, under the paths supabase-js expects, so supabase-js is the
   client here. Nothing outside this module knows that: everything else
   imports `api` and the helpers below.

   Which server: the web app always uses the server it was loaded from.
   The Android app asks once (screens/Connect.jsx) and remembers it; a
   build can also come preconfigured with VITE_SERVER_URL. */

const STORAGE_KEY = 'ktl.server';

/* "ktl.example.com" or "https://ktl.example.com/android/home" both mean
   https://ktl.example.com. Returns '' for anything that isn't a web
   address. */
export function normaliseServerUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname || !/^https?:$/.test(url.protocol)) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function readStored() {
  try { return normaliseServerUrl(localStorage.getItem(STORAGE_KEY)); } catch { return ''; }
}

export function resolveServerUrl({ native, stored, built, origin }) {
  if (native) return stored || built || '';
  return built || origin || '';
}

export const IS_NATIVE = Capacitor.isNativePlatform();

export const SERVER_URL = resolveServerUrl({
  native: IS_NATIVE,
  stored: readStored(),
  built: normaliseServerUrl(import.meta.env.VITE_SERVER_URL),
  origin: typeof window !== 'undefined' ? window.location.origin : ''
});

/* The server doesn't check an API key — access is decided by the signed-in
   person's token and the database's row-level security — but the client
   library insists on one, so this placeholder fills the slot. */
const CLIENT_KEY = 'ktl';

export const api = SERVER_URL ? createClient(SERVER_URL, CLIENT_KEY) : null;

export function hasServer() {
  return Boolean(SERVER_URL);
}

/* Native only: remember a server and restart the app against it. */
export function setServer(url) {
  try { localStorage.setItem(STORAGE_KEY, normaliseServerUrl(url)); } catch { /* private mode */ }
}

export function clearServer() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* private mode */ }
}

/* What a server says about itself (GET /api/config). Throws a readable
   error when the address isn't a KTL server or can't be reached. */
export async function fetchServerInfo(url = SERVER_URL, { timeoutMs = 8000 } = {}) {
  const base = normaliseServerUrl(url);
  if (!base) throw new Error('Enter your server’s address, like ktl.example.com.');
  let res;
  try {
    // Older Android WebViews have no AbortSignal.timeout; they just wait.
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
    res = await fetch(`${base}/api/config`, { signal, cache: 'no-store' });
  } catch {
    throw new Error('Couldn’t reach that address. Check it, and that this device can get to it.');
  }
  const info = await res.json().catch(() => null);
  if (!res.ok || info?.app !== 'ktl') throw new Error('That address answered, but it isn’t a KTL server.');
  return { ...info, url: base };
}

/* Whether the server can send email (password resets). */
export async function serverSendsEmail() {
  try {
    return Boolean((await fetchServerInfo()).email);
  } catch {
    return false;
  }
}

/* KTL's own endpoints (/api/...), signed in as the current person. */
export async function apiFetch(path, { method = 'GET', body, headers = {} } = {}) {
  const { data } = await api.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.message || 'The server couldn’t do that. Try again.');
    err.status = res.status;
    err.code = json.error;
    throw err;
  }
  return json;
}
