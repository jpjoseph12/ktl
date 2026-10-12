import pg from 'pg';

/* The gateway and the admin/setup scripts run as the `postgres` OS user
   and reach the database over its Unix socket, where peer authentication
   lets them in as the `postgres` role without a password. */
export const SOCKET_DIR = process.env.KTL_PG_SOCKET || '/var/run/postgresql';

export function connectionOptions(extra = {}) {
  return { host: SOCKET_DIR, user: 'postgres', database: 'postgres', application_name: 'ktl', ...extra };
}

let pool;
export function getPool() {
  if (!pool) {
    pool = new pg.Pool(connectionOptions({ max: 5, idleTimeoutMillis: 30000 }));
    pool.on('error', (err) => console.error('gateway: idle database connection failed', err.message));
  }
  return pool;
}

export async function withClient(fn) {
  const client = new pg.Client(connectionOptions());
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/* For the few statements that can't take parameters (ALTER ROLE … PASSWORD).
   standard_conforming_strings is on, so doubling quotes is enough. */
export const escapeLiteral = (s) => `'${String(s).replace(/'/g, "''")}'`;

export const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;
