import { createHmac, timingSafeEqual } from 'node:crypto';

/* HS256 only — the one algorithm GoTrue signs with here. Small enough
   that a JWT library would be more code to trust than this. */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signJwt(payload, secret, { expiresIn = 60 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: now, exp: now + expiresIn, ...payload }));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

/* Returns the claims, or null for anything that isn't a valid, unexpired
   token signed with `secret`. */
export function verifyJwt(token, secret, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  let head;
  let claims;
  try {
    head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (head?.alg !== 'HS256') return null;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (typeof claims.exp === 'number' && claims.exp * 1000 <= now) return null;
  return claims;
}

export function looksLikeJwt(token) {
  return typeof token === 'string' && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
}

export function bearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}
