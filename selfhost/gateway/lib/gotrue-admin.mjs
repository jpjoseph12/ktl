import { config } from './config.mjs';
import { signJwt } from './jwt.mjs';

/* GoTrue's admin API, called as service_role with a one-minute token the
   gateway mints itself. Never exposed to clients: the gateway refuses
   /auth/v1/admin/* from outside.

   GoTrue restarts for a moment whenever its settings change, so a request
   that can't connect is retried for a few seconds before giving up. */
export async function gotrueAdmin(method, route, body, { retryForMs = 15000 } = {}) {
  const token = signJwt({ role: 'service_role', iss: 'ktl-gateway' }, config.jwtSecret, { expiresIn: 60 });
  const until = Date.now() + retryForMs;
  let res;
  for (;;) {
    try {
      res = await fetch(`${config.gotrue}/admin${route}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      break;
    } catch (err) {
      if (Date.now() > until) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(json?.msg || json?.message || json?.error_description || text || `GoTrue ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}
