/* Builds the public, signed Android APK — the one to attach to a GitHub
 * release:
 *
 *   npm run android:apk
 *
 * It's a release build (not debuggable), signed with the release key
 * (android/keystore.properties, or the KTL_KEYSTORE_* environment
 * variables in CI), with no server address baked in (the app asks), and
 * no Firebase project (KTL_PUBLIC_BUILD=1 — push needs a build made for a
 * particular server). The result is release/ktl-<version>.apk, with a
 * .sha256 beside it for people to check their download against.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const env = { ...process.env, KTL_PUBLIC_BUILD: '1', VITE_SERVER_URL: '' };

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('npx', ['vite', 'build']);
run('node', ['scripts/verify-release.mjs']);
run('npx', ['cap', 'sync', 'android']);
run('node', ['scripts/gradlew.mjs', 'assembleRelease']);

const built = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!fs.existsSync(built)) {
  console.error(`No APK at ${built}.`);
  process.exit(1);
}
const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });
const name = `ktl-${version}.apk`;
const out = path.join(outDir, name);
fs.copyFileSync(built, out);
const sum = createHash('sha256').update(fs.readFileSync(out)).digest('hex');
fs.writeFileSync(`${out}.sha256`, `${sum}  ${name}\n`);
console.log(`\nBuilt ${path.relative(root, out)}\nSHA-256 ${sum}`);
