/* ktl-admin — run inside the container:  docker exec -it ktl ktl-admin <command> */
import { createInterface } from 'node:readline/promises';
import { config } from './lib/config.mjs';
import { withClient } from './lib/db.mjs';
import { gotrueAdmin } from './lib/gotrue-admin.mjs';
import { importData, jsonSource } from './lib/importer.mjs';
import { listBackups, runBackup } from './lib/backup.mjs';

const HELP = `ktl-admin — manage this KTL server

  setup-code                      print the code the /setup page asks for
  status                          what's here: accounts, households, backups, push
  users                           list accounts
  reset-link <email>              print a one-time link that lets someone set a
                                  new password (works without an email server)
  set-password <email>            set someone's password (you'll be asked for it)
  import-json <file>              load a JSON export of KTL's data
  backup                          take a backup now (into /data/backups)
  restore <file> --yes            replace everything with a backup

  An import refuses to overwrite existing data unless you add --force.
  Everything else — people, address, sign-ups, email, push, backups — is
  also on the admin page: open <your address>/admin as the owner.`;

async function findUser(email) {
  const { rows: [u] } = await withClient((c) => c.query(
    'select id, email from auth.users where lower(email) = lower($1)', [email]
  ));
  if (!u) throw new Error(`No account for ${email}.`);
  return u;
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

const commands = {
  async 'setup-code'() {
    console.log(config.setupCode || 'No setup code yet — restart the container.');
  },

  async status() {
    const s = await withClient(async (c) => {
      const one = async (sql) => (await c.query(sql)).rows[0];
      return {
        users: (await one('select count(*)::int as n from auth.users')).n,
        households: (await one('select count(*)::int as n from public.households')).n,
        imported: (await one("select value from ktl_meta.settings where key = 'imported_from'"))?.value
      };
    });
    const backups = listBackups();
    console.log(`Site:        ${config.siteUrl}`);
    console.log(`Accounts:    ${s.users}   Households: ${s.households}`);
    console.log(`Sign-ups:    ${config.allowSignup ? 'open' : 'closed'}   Email: ${config.emailEnabled ? 'on' : 'off (use reset-link)'}`);
    console.log(`Imported:    ${s.imported || 'never'}`);
    console.log(`Backups:     ${backups.length ? `${backups.length}, latest ${backups.at(-1).name}` : 'none yet'}`);
  },

  async users() {
    const { rows } = await withClient((c) => c.query(`
      select u.email, p.full_name, u.created_at, u.last_sign_in_at,
             coalesce(u.encrypted_password, '') <> '' as has_password
        from auth.users u left join public.profiles p on p.id = u.id
       order by u.created_at`));
    if (!rows.length) return console.log('No accounts yet.');
    for (const r of rows) {
      const last = r.last_sign_in_at ? new Date(r.last_sign_in_at).toISOString().slice(0, 10) : 'never';
      console.log(`${r.email.padEnd(34)} ${(r.full_name || '').padEnd(22)} last in ${last}${r.has_password ? '' : '   (no password yet — send a reset-link)'}`);
    }
  },

  async 'reset-link'(email) {
    if (!email) throw new Error('Usage: ktl-admin reset-link <email>');
    await findUser(email);
    const link = await gotrueAdmin('POST', '/generate_link', {
      type: 'recovery', email, redirect_to: `${config.siteUrl}/android/home`
    });
    const url = link?.action_link || link?.properties?.action_link;
    if (!url) throw new Error('GoTrue did not return a link.');
    console.log(`Send this to ${email}. It works once and expires in an hour:\n\n${url}\n`);
  },

  async 'set-password'(email, password) {
    if (!email) throw new Error('Usage: ktl-admin set-password <email>');
    const u = await findUser(email);
    const pw = password || await ask(`New password for ${u.email}: `);
    if (pw.length < 8) throw new Error('Use at least 8 characters.');
    await gotrueAdmin('PUT', `/users/${u.id}`, { password: pw });
    console.log(`Password set for ${u.email}.`);
  },

  async 'import-json'(file, ...rest) {
    if (!file) throw new Error('Usage: ktl-admin import-json <file> [--force]');
    const counts = await withClient((c) => importData(c, jsonSource(file), { force: rest.includes('--force') }));
    console.log(`\nImported ${Object.values(counts).reduce((a, b) => a + b, 0)} rows.`);
  },

  async backup() {
    const file = await runBackup({ label: 'manual' });
    console.log(`Backed up to ${file}`);
  },

  /* Replaces everything with a backup, in one transaction: if anything
     fails, nothing changed. A fresh backup is taken first, just in case. */
  async restore(file, ...rest) {
    if (!file) {
      const list = listBackups();
      throw new Error(`Usage: ktl-admin restore <file> --yes\n\nBackups:\n${list.map((b) => `  ${b.file}`).join('\n') || '  none'}`);
    }
    if (!rest.includes('--yes')) throw new Error('This replaces ALL data with the backup. Add --yes to go ahead.');
    const safety = await runBackup({ label: 'before-restore' });
    console.log(`Current data saved to ${safety}`);

    /* The backup is a whole-database dump. Replaying it over the existing
       schemas (pg_restore --clean) trips over objects that depend on each
       other across schemas, so instead: drop KTL's schemas, then load the
       dump — both in one transaction, so a failure changes nothing. */
    const { spawn } = await import('node:child_process');
    await withClient((c) => c.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'postgres' and pid <> pg_backend_pid()"
    ));
    const clear = [
      'drop schema if exists private, ktl_meta, auth, extensions cascade',
      'drop schema if exists public cascade',
      'create schema public authorization pg_database_owner'
    ].join('; ');
    const sql = spawn('pg_restore', ['-f', '-', file], { stdio: ['ignore', 'pipe', 'inherit'] });
    const psql = spawn('psql', ['-X', '-q', '-1', '-v', 'ON_ERROR_STOP=1', '-h', '/var/run/postgresql', '-U', 'postgres', '-d', 'postgres', '-c', clear, '-f', '-'], { stdio: ['pipe', 'ignore', 'inherit'] });
    sql.stdout.pipe(psql.stdin);
    const [dumpOk, loadOk] = await Promise.all([
      new Promise((r) => sql.on('close', (code) => r(code === 0))),
      new Promise((r) => psql.on('close', (code) => r(code === 0)))
    ]);
    if (!dumpOk || !loadOk) throw new Error('Restore failed; nothing was changed.');
    console.log('Restored. Now restart the container (docker restart ktl) so every service picks it up.\nEveryone will need to log in again.');
  }
};

const [cmd = 'help', ...args] = process.argv.slice(2);
const run = commands[cmd];
if (!run) {
  console.log(HELP);
  process.exit(cmd === 'help' || cmd === '--help' ? 0 : 1);
}
run(...args).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
