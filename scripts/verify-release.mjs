/* Pre-flight for a Play Store build. Run after `npm run build` (the
 * production web build) and before bundling — `npm run android:release`
 * does both. Exits non-zero, naming every problem, if the build isn't
 * safe to ship.
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
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
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

// 1. There has to be a web build to package.
const dist = path.join(root, 'dist');
if (!filesUnder(dist, ['.js', '.html']).length) {
  problems.push('No web build in dist/ — run `npm run build` first.');
}

if (!bundleOnly) {
  // 2. The public legal pages need a real contact address before they're linked from the store listing.
  for (const file of filesUnder(path.join(root, 'public', 'legal'), ['.html'])) {
    if (fs.readFileSync(file, 'utf8').includes('CONTACT_EMAIL')) {
      problems.push(`${path.relative(root, file)} still has the CONTACT_EMAIL placeholder — put in the address people can reach you on.`);
    }
  }

  // 3. A signed bundle needs the upload key configured.
  const propsFile = path.join(root, 'android', 'keystore.properties');
  if (!fs.existsSync(propsFile)) {
    problems.push('android/keystore.properties is missing — copy keystore.properties.example and point it at your upload key.');
  } else {
    const props = readEnvFile(propsFile);
    for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
      if (!props[key]) problems.push(`android/keystore.properties has no ${key}.`);
    }
    if (props.storeFile && !fs.existsSync(path.resolve(root, 'android', props.storeFile))) {
      problems.push(`The upload key ${props.storeFile} (relative to android/) doesn't exist.`);
    }
  }
}

if (problems.length) {
  console.error('\nNot ready to release:\n' + problems.map((p) => '  • ' + p).join('\n') + '\n');
  process.exit(1);
}
console.log(bundleOnly ? 'Production bundle is clean.' : 'Release checks passed.');
