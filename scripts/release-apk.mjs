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
/* Every release is signed with KTL's release key — the same one each time,
   or phones can't update from one version to the next. The key's public
   certificate fingerprint is pinned in android/release-cert.sha256; an APK
   that's unsigned, or signed with anything else, stops the release here. */
function apksigner() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
    || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
  const tools = sdk && path.join(sdk, 'build-tools');
  if (!tools || !fs.existsSync(tools)) return null;
  const versions = fs.readdirSync(tools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const v of versions.reverse()) {
    const bin = path.join(tools, v, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner');
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}
const signer = apksigner();
if (!signer) {
  console.error('Can’t find apksigner in the Android SDK build-tools, so the release can’t be checked. Set ANDROID_HOME.');
  process.exit(1);
}
const check = spawnSync(process.platform === 'win32' ? `"${signer}"` : signer, ['verify', '--print-certs', `"${built}"`], {
  encoding: 'utf8', shell: true
});
const fingerprint = /Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})/i.exec(check.stdout || '')?.[1]?.toLowerCase();
const pinned = fs.readFileSync(path.join(root, 'android', 'release-cert.sha256'), 'utf8').trim().toLowerCase();
if (check.status !== 0 || !fingerprint) {
  console.error(`The APK isn’t properly signed:\n${(check.stdout || '') + (check.stderr || '')}`);
  process.exit(1);
}
if (fingerprint !== pinned) {
  console.error(`The APK is signed with the wrong key.\n  signed with: ${fingerprint}\n  KTL’s key:   ${pinned}\nPhones with KTL installed couldn’t update to it. Use the release key in android/keystore.properties (or the KTL_KEYSTORE_* secrets).`);
  process.exit(1);
}
console.log(`\nSigned with KTL’s release key (${fingerprint.slice(0, 12)}…).`);

const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });
const name = `ktl-${version}.apk`;
const out = path.join(outDir, name);
fs.copyFileSync(built, out);
const sum = createHash('sha256').update(fs.readFileSync(out)).digest('hex');
fs.writeFileSync(`${out}.sha256`, `${sum}  ${name}\n`);
console.log(`\nBuilt ${path.relative(root, out)}\nSHA-256 ${sum}`);
