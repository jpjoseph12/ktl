/* "Snooze" on the Alerts screen used to be entirely decorative — the
   button showed a toast ("Snoozed until later today") but never changed
   any state, so the item was still there on the very next render. This
   is the real, persisted version: same localStorage-backed pattern
   WalkthroughContext already uses for `hasSeen`, keyed per-user so one
   household member snoozing something doesn't hide it from anyone else.

   Read at call-time rather than tracked as a live boolean — a snooze
   simply stops matching once `now` passes its expiry, so nothing needs a
   timer to "wake it back up".
*/
const PREFIX = 'ktl:snooze:';

// A plain, predictable few hours rather than snapping to a fixed clock
// time (e.g. "8pm today") — the latter reads fine at 10am and is already
// in the past, and therefore useless, by 9pm.
const DURATION_MS = 6 * 60 * 60 * 1000;

function storageKey(userId, key) {
  return `${PREFIX}${userId}:${key}`;
}

export function isSnoozed(userId, key, now = Date.now()) {
  if (!userId) return false;
  try {
    const raw = localStorage.getItem(storageKey(userId, key));
    return raw != null && Number(raw) > now;
  } catch {
    return false; // no persistence available — never hide something we can't actually track
  }
}

export function snoozeUntilLater(userId, key) {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId, key), String(Date.now() + DURATION_MS));
  } catch {
    // no persistence available — the snooze just won't stick, same as before this fix
  }
}
