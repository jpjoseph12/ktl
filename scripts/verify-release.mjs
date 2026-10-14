/* Pre-flight for a release. Run after `npm run build` (the production web
 * build) and before packaging — `npm run android:apk` and
 * `npm run android:release` do both. Exits non-zero, naming every
 * problem, if the build isn't safe to publish.
 *
 *   node scripts/verify-release.mjs            full check (release)
 *   node scripts/verify-release.mjs --bundle   bundle-only check (CI)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleOnly = process.argv.includes('--bundle');
const problems = [];

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function filesUnder(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return filesUnder(p, ext);
    return ext.some((x) => p.endsWith(x)) ? [p] : [];
  });
}

/* Things that must never ship in a public build. The client library's own
   generic "supabase.co" text is fine; a project's address isn't. */
const LEAKS = [
  [/\b(?:192\.168|10\.\d{1,3})\.\d{1,3}\.\d{1,3}(?::\d+)?\b/, 'a home-network address'],
  [/[A-Za-z0-9._%+-]+@gmail\.com/i, 'a personal email address'],
  [/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'a sign-in token (JWT)'],
  [/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{10,}/, 'a hosted-backend key'],
  [/\b[a-z0-9]{20}\.supabase\.co\b/, 'a hosted-backend project address'],
  [/AIza[0-9A-Za-z_-]{35}/, 'a Google/Firebase API key'],
  [/CONTACT_EMAIL/, 'the CONTACT_EMAIL placeholder']
];

// 1. There has to be a web build to package, and it has to be clean.
const dist = path.join(root, 'dist');
const built = filesUnder(dist, ['.js', '.html', '.css', '.json', '.txt']);
if (!built.length) problems.push('No web build in dist/ — run `npm run build` first.');
const scan = [...built, ...filesUnder(path.join(root, 'public', 'legal'), ['.html'])];
for (const file of scan) {
  const text = fs.readFileSync(file, 'utf8');
  for (const [re, what] of LEAKS) {
    const m = re.exec(text);
    if (m) problems.push(`${path.relative(root, file)} contains ${what}: “${m[0].slice(0, 40)}”.`);
  }
}

if (!bundleOnly) {
  // 2. A release needs its key: android/keystore.properties, or the
  //    KTL_KEYSTORE_* environment variables (the GitHub workflow).
  const propsFile = path.join(root, 'android', 'keystore.properties');
  if (process.env.KTL_KEYSTORE_FILE) {
    if (!fs.existsSync(process.env.KTL_KEYSTORE_FILE)) problems.push(`KTL_KEYSTORE_FILE points at ${process.env.KTL_KEYSTORE_FILE}, which doesn't exist.`);
    for (const key of ['KTL_KEYSTORE_PASSWORD', 'KTL_KEY_ALIAS', 'KTL_KEY_PASSWORD']) {
      if (!process.env[key]) problems.push(`${key} isn't set.`);
    }
  } else if (!fs.existsSync(propsFile)) {
    problems.push('No release key — copy android/keystore.properties.example to android/keystore.properties and point it at your key.');
  } else {
    const props = readEnvFile(propsFile);
    for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
      if (!props[key]) problems.push(`android/keystore.properties has no ${key}.`);
    }
    if (props.storeFile && !fs.existsSync(path.resolve(root, 'android', props.storeFile))) {
      problems.push(`The key ${props.storeFile} (relative to android/) doesn't exist.`);
    }
  }
}

if (problems.length) {
  console.error('\nNot ready to release:\n' + problems.map((p) => '  • ' + p).join('\n') + '\n');
  process.exit(1);
}
console.log(bundleOnly ? 'Production bundle is clean.' : 'Release checks passed.');
