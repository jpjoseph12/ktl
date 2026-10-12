/* Runs once per boot, before GoTrue, PostgREST and the gateway start:
 *
 *   1. bootstrap.sql   the roles and schemas GoTrue and PostgREST expect
 *   2. gotrue migrate  GoTrue's own auth.* tables
 *   3. after-auth.sql  auth.uid() & co., which row-level security calls
 *   4. migrations/     KTL's schema (db/migrations), in order
 *   5. selfhost.sql    the NOTIFY on new activity that live updates and
 *                      push notifications hang off
 *
 * Every step is idempotent, so an upgraded image just applies what's new.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { escapeLiteral, withClient } from './lib/db.mjs';

const DB_DIR = process.env.KTL_DB_DIR || '/app/db';
const read = (name) => readFileSync(path.join(DB_DIR, name), 'utf8');

export function migrationFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((file) => ({ file, version: file.split('_')[0], name: file.replace(/^\d+_/, '').replace(/\.sql$/, '') }));
}

async function main() {
  await withClient(async (c) => {
    await c.query(read('bootstrap.sql'));
    await c.query(`alter role authenticator with login password ${escapeLiteral(process.env.KTL_AUTHENTICATOR_PASSWORD)}`);
    await c.query(`alter role supabase_auth_admin with login password ${escapeLiteral(process.env.KTL_AUTH_ADMIN_PASSWORD)}`);
  });
  console.log('ktl: database roles ready');

  const migrate = spawnSync('/usr/local/bin/gotrue', ['migrate'], { stdio: 'inherit', env: process.env });
  if (migrate.status !== 0) throw new Error(`GoTrue migrations failed (exit ${migrate.status})`);
  console.log('ktl: sign-in tables ready');

  await withClient(async (c) => {
    await c.query(read('after-auth.sql'));

    const { rows } = await c.query('select version from ktl_meta.schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    const pending = migrationFiles(path.join(DB_DIR, 'migrations')).filter((m) => !applied.has(m.version));
    for (const m of pending) {
      const sql = readFileSync(path.join(DB_DIR, 'migrations', m.file), 'utf8');
      try {
        await c.query('begin');
        // Function bodies aren't checked as they're created: a body may
        // name something that only exists once a later migration runs.
        await c.query('set local check_function_bodies = off');
        await c.query(sql);
        await c.query('insert into ktl_meta.schema_migrations (version, name) values ($1, $2)', [m.version, m.name]);
        await c.query('commit');
        console.log(`ktl: applied migration ${m.file}`);
      } catch (err) {
        await c.query('rollback').catch(() => {});
        throw new Error(`migration ${m.file} failed: ${err.message}`);
      }
    }

    const { rows: [{ ok }] } = await c.query("select to_regclass('public.activity') is not null as ok");
    if (ok) await c.query(read('selfhost.sql'));
    await c.query("notify pgrst, 'reload schema'");
  });
  console.log('ktl: database ready');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`ktl: database setup failed: ${err.message}`);
    process.exit(1);
  });
}
