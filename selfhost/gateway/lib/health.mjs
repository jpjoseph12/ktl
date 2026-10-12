import { config } from './config.mjs';
import { getPool } from './db.mjs';

/* Is every part of the server answering? The database, sign-in (GoTrue)
   and the data API (PostgREST). Used by /healthz and the admin page. */
export async function probeHealth() {
  const probe = async (fn) => { try { await fn(); return true; } catch { return false; } };
  const ok = (r) => { if (!r.ok) throw new Error(String(r.status)); };
  const [database, auth, api] = await Promise.all([
    probe(() => getPool().query('select 1')),
    probe(async () => ok(await fetch(`${config.gotrue}/health`, { signal: AbortSignal.timeout(2000) }))),
    probe(async () => ok(await fetch(`${config.postgrestAdmin}/ready`, { signal: AbortSignal.timeout(2000) })))
  ]);
  return { healthy: database && auth && api, database, auth, api };
}
