/* The app lock: a PIN (and, on Android, fingerprint or face) asked for
   when KTL is opened, or come back to after a while. It's per person and
   per device, kept on the device only.

   The PIN itself is never stored — only a PBKDF2 hash of it with a random
   salt. The lock is a screen in front of the signed-in app; it doesn't
   encrypt anything, which the settings say plainly. */

const PREFIX = 'ktl.lock.v1:';
const ITERATIONS = 210_000;
export const MAX_TRIES = 5;
export const LOCK_AFTER = [
  { seconds: 0, label: 'Straight away' },
  { seconds: 60, label: 'After 1 minute' },
  { seconds: 300, label: 'After 5 minutes' },
  { seconds: 900, label: 'After 15 minutes' }
];

export const validPin = (pin) => /^\d{4,6}$/.test(String(pin || ''));

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(String(s).match(/../g).map((h) => parseInt(h, 16)));

async function hashPin(pin, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return hex(bits);
}

export function readLock(userId) {
  if (!userId) return null;
  try {
    const v = JSON.parse(localStorage.getItem(PREFIX + userId) || 'null');
    return v?.hash && v?.salt ? v : null;
  } catch {
    return null;
  }
}

function writeLock(userId, value) {
  try { localStorage.setItem(PREFIX + userId, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export async function setPin(userId, pin, { biometrics = false, after = 0 } = {}) {
  if (!validPin(pin)) throw new Error('Use 4 to 6 digits.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPin(pin, salt);
  const prev = readLock(userId);
  writeLock(userId, {
    salt: hex(salt), hash, iterations: ITERATIONS, length: String(pin).length,
    biometrics: prev ? prev.biometrics : biometrics,
    after: prev ? prev.after : after,
    fails: 0
  });
}

export async function verifyPin(userId, pin) {
  const lock = readLock(userId);
  if (!lock) return { ok: true, remaining: MAX_TRIES };
  const ok = (await hashPin(pin, unhex(lock.salt), lock.iterations || ITERATIONS)) === lock.hash;
  const fails = ok ? 0 : (lock.fails || 0) + 1;
  writeLock(userId, { ...lock, fails });
  return { ok, remaining: Math.max(0, MAX_TRIES - fails) };
}

/* A successful fingerprint or face also resets the count. */
export function resetFails(userId) {
  const lock = readLock(userId);
  if (lock && lock.fails) writeLock(userId, { ...lock, fails: 0 });
}

export function updateLock(userId, patch) {
  const lock = readLock(userId);
  if (lock) writeLock(userId, { ...lock, ...patch });
}

export function clearLock(userId) {
  try { localStorage.removeItem(PREFIX + userId); } catch { /* storage unavailable */ }
}

/* Should coming back after `awaySeconds` ask again? */
export function shouldRelock(lock, awaySeconds) {
  return Boolean(lock) && awaySeconds >= (lock.after || 0);
}
