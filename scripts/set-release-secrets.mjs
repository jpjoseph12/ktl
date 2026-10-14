/* Adds the release key to a GitHub repository as the four secrets the
 * "Android app" workflow (release.yml) signs with — in any terminal
 * (PowerShell, cmd, bash):
 *
 *   node scripts/set-release-secrets.mjs OWNER/ktl
 *
 * Reads android/keystore.properties and the key file it points at, and
 * hands each value straight to `gh secret set` on its standard input, so
 * no password is ever typed, shown or put on a command line. Needs the
 * GitHub CLI, signed in (`gh auth status`).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.argv[2];
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('Usage: node scripts/set-release-secrets.mjs OWNER/ktl');
  process.exit(1);
}

const propsFile = path.join(root, 'android', 'keystore.properties');
if (!fs.existsSync(propsFile)) {
  console.error('android/keystore.properties is missing — there is no release key to upload.');
  process.exit(1);
}
const props = {};
for (const line of fs.readFileSync(propsFile, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) props[m[1]] = m[2];
}
for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
  if (!props[key]) {
    console.error(`android/keystore.properties has no ${key}.`);
    process.exit(1);
  }
}
const keyFile = path.resolve(root, 'android', props.storeFile);
if (!fs.existsSync(keyFile)) {
  console.error(`The key file ${keyFile} doesn't exist.`);
  process.exit(1);
}

const secrets = [
  ['KTL_KEYSTORE_BASE64', fs.readFileSync(keyFile).toString('base64')],
  ['KTL_KEYSTORE_PASSWORD', props.storePassword],
  ['KTL_KEY_ALIAS', props.keyAlias],
  ['KTL_KEY_PASSWORD', props.keyPassword]
];
/* Push in releases: the Firebase project's app config, if this copy has
   one. (Not a secret — it's inside every APK — but kept out of the code so
   copies of KTL aren't tied to this project.) */
const servicesFile = path.join(root, 'android', 'app', 'google-services.json');
if (fs.existsSync(servicesFile)) secrets.push(['GOOGLE_SERVICES_JSON', fs.readFileSync(servicesFile, 'utf8')]);
else console.log('No android/app/google-services.json — releases will have no push.');

let failed = false;
for (const [name, value] of secrets) {
  const r = spawnSync('gh', ['secret', 'set', name, '--repo', repo], {
    input: value,
    stdio: ['pipe', 'ignore', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (r.status === 0) {
    console.log(`✓ ${name}`);
  } else {
    failed = true;
    console.error(`✗ ${name}: ${String(r.stderr || r.error?.message || 'gh failed').trim()}`);
  }
}
if (failed) {
  console.error('\nSome secrets weren’t set. Check `gh auth status`, and that you can change settings on that repository.');
  process.exit(1);
}
console.log(`\nAll ${secrets.length} are set on ${repo}. Check with: gh secret list --repo ${repo}`);
