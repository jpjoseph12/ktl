export function validName(v) {
  return v.trim().length > 1;
}

export function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/* What a bill came to, as typed: pounds with up to two decimal places.
   Negative is allowed (a credit month); zero isn't, since a bill that came
   to nothing is almost always a typo. Returns null when it doesn't parse. */
export function parseBillAmount(v) {
  const s = String(v ?? '').trim().replace(/^£/, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = parseFloat(s);
  return n === 0 ? null : n;
}

/* GoTrue's own minimum is configured to match this on the self-hosted
   server, so the form catches it before a round trip. */
export const MIN_PASSWORD_LENGTH = 8;

export function validPassword(v) {
  return typeof v === 'string' && v.length >= MIN_PASSWORD_LENGTH;
}
