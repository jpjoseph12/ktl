import { readFileSync } from 'node:fs';
import { quoteIdent } from './db.mjs';

/* Loads a JSON export of KTL's data into this server's database:
 * accounts (auth.users + auth.identities, password hashes included) and
 * every table in public. The export is { "schema.table": [rows…] }.
 *
 * Runs in one transaction with triggers and foreign-key checks deferred
 * (session_replication_role = replica), so table order doesn't matter
 * and nothing fires a notification or a push for old activity. Only
 * columns present on both sides are copied: a column this server's
 * sign-in service added since keeps its default. */

const AUTH_TABLES = ['auth.users', 'auth.identities'];

export function jsonSource(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return {
    label: file,
    async rows(qualified) { return Array.isArray(data[qualified]) ? data[qualified] : null; },
    async tables() { return Object.keys(data).filter((k) => k.startsWith('public.')); },
    async close() {}
  };
}

async function localPublicTables(db) {
  const { rows } = await db.query(
    "select 'public.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname"
  );
  return rows.map((r) => r.t);
}

async function insertableColumns(db, qualified) {
  const { rows } = await db.query(
    `select a.attname as name, a.attidentity as identity
       from pg_attribute a
      where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      order by a.attnum`,
    [qualified]
  );
  return rows;
}

const qualify = (q) => q.split('.').map(quoteIdent).join('.');

export async function isEmpty(db) {
  const tables = ['auth.users', ...(await localPublicTables(db))];
  for (const t of tables) {
    const { rowCount } = await db.query(`select 1 from ${qualify(t)} limit 1`);
    if (rowCount) return false;
  }
  return true;
}

export async function importData(db, source, { force = false, log = console.log } = {}) {
  if (!force && !(await isEmpty(db))) {
    throw new Error('This server already has data. Re-run with --force to replace all of it with the import.');
  }
  const publicTables = await localPublicTables(db);
  const sourceTables = new Set(await source.tables());
  const notHere = [...sourceTables].filter((t) => !publicTables.includes(t));
  if (notHere.length) log(`! not copied (no such table here): ${notHere.join(', ')}`);

  const counts = {};
  await db.query('begin');
  try {
    await db.query("set local session_replication_role = 'replica'");
    await db.query(`truncate ${[...AUTH_TABLES, ...publicTables].map(qualify).join(', ')} cascade`);

    for (const table of [...AUTH_TABLES, ...publicTables]) {
      const rows = await source.rows(table);
      if (!rows) { log(`- ${table}: not in the source, left empty`); continue; }
      if (!rows.length) { counts[table] = 0; continue; }
      const sourceKeys = new Set(rows.flatMap((r) => Object.keys(r)));
      const cols = (await insertableColumns(db, table)).filter((c) => sourceKeys.has(c.name));
      const colList = cols.map((c) => quoteIdent(c.name)).join(', ');
      const overriding = cols.some((c) => c.identity === 'a') ? ' overriding system value' : '';
      for (let i = 0; i < rows.length; i += 500) {
        await db.query(
          `insert into ${qualify(table)} (${colList})${overriding} select ${colList} from json_populate_recordset(null::${qualify(table)}, $1::json)`,
          [JSON.stringify(rows.slice(i, i + 500))]
        );
      }
      counts[table] = rows.length;
      log(`- ${table}: ${rows.length}`);
    }

    // Serial columns carry on from the highest imported value.
    await db.query(`
      do $$
      declare s record;
      begin
        for s in
          select seq.oid::regclass as seq, tbl.oid::regclass as tbl, att.attname as col
            from pg_class seq
            join pg_depend d on d.objid = seq.oid and d.deptype in ('a', 'i')
            join pg_class tbl on tbl.oid = d.refobjid
            join pg_attribute att on att.attrelid = tbl.oid and att.attnum = d.refobjsubid
            join pg_namespace n on n.oid = tbl.relnamespace
           where seq.relkind = 'S' and n.nspname in ('public', 'auth')
        loop
          execute format('select setval(%s, coalesce((select max(%I) from %s), 0) + 1, false)', quote_literal(s.seq::text), s.col, s.tbl);
        end loop;
      end
      $$`);

    await db.query(
      "insert into ktl_meta.settings (key, value) values ('imported_from', $1) on conflict (key) do update set value = excluded.value, updated_at = now()",
      [`${source.label} at ${new Date().toISOString()}`]
    );
    await db.query('commit');
  } catch (err) {
    await db.query('rollback').catch(() => {});
    throw err;
  } finally {
    await source.close();
  }
  return counts;
}
