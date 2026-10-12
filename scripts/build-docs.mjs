/* Keeps the guide page in docs/ (served by GitHub Pages) in step with the
 * app: it shares the app's design tokens and brand images.
 *
 *   node scripts/build-docs.mjs           copy them into docs/
 *   node scripts/build-docs.mjs --check   fail if docs/ is out of date (CI)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COPIES = [
  ['src/styles/tokens.css', 'docs/tokens.css'],
  ['public/assets/brand/favicon.png', 'docs/assets/favicon.png'],
  ['public/assets/brand/logo-kettle.png', 'docs/assets/logo-kettle.png']
];

const check = process.argv.includes('--check');
const stale = [];
for (const [from, to] of COPIES) {
  const src = fs.readFileSync(path.join(root, from));
  const dest = path.join(root, to);
  const current = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
  if (current && current.equals(src)) continue;
  if (check) {
    stale.push(to);
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, src);
    console.log(`Updated ${to}`);
  }
}

if (stale.length) {
  console.error(`docs/ is out of date: ${stale.join(', ')}.\nRun: node scripts/build-docs.mjs`);
  process.exit(1);
}
if (check) console.log('docs/ is up to date.');
