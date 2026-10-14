/* Screenshots of KTL for the guide in docs/ — taken from a real server with
 * a made-up household, never anyone's actual data.
 *
 *   node scripts/e2e-server.mjs          a throwaway server (Docker)
 *   node scripts/screenshots.mjs         fill it, then photograph it
 *
 * Needs Playwright (`npm i --no-save playwright` and
 * `npx playwright install chromium`). Writes docs/screens/<kind>-<screen>.png
 * for kind = phone, tablet, desktop. Run by .github/workflows/screenshots.yml.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.KTL_E2E_PORT || '8095';
const BASE = process.env.KTL_SCREENSHOT_BASE || `http://127.0.0.1:${PORT}`;
const EMAIL = process.env.E2E_EMAIL || 'e2e-owner@ktl.test';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e-password-123';
const OUT = path.join(root, 'docs', 'screens');

async function call(p, { method = 'GET', body, token, prefer } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: 'ktl',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const out = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 300)}`);
  return out;
}
const rest = (table, body, token) => call(`/rest/v1/${table}`, { method: 'POST', body, token, prefer: 'return=representation' });

/* ── a made-up household ─────────────────────────────────────────── */
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function seed() {
  const { access_token: token, user } = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  const me = user.id;
  const admin = await call('/api/admin', { token });
  const partner = admin.people.find((p) => p.id !== me && p.inHousehold);
  await call('/api/admin/household', { method: 'PUT', token, body: { name: 'Flat 4', payoutRef: 'FLAT4 BILLS' } });
  await call(`/api/admin/people/${me}`, { method: 'PATCH', token, body: { name: 'Alex Rivera' } });
  await call(`/api/admin/people/${partner.id}`, { method: 'PATCH', token, body: { name: 'Sam Okafor' } });
  await call(`/rest/v1/profiles?id=eq.${me}`, { method: 'PATCH', token, body: { onboarded_at: new Date().toISOString() } });
  const hid = await call('/rest/v1/rpc/join_server_household', { method: 'POST', token, body: {} });

  const bills = [
    ['Rent', 1450, me, 9, 'scheduled', null, 'home'],
    ['Energy', 96.4, partner.id, 4, 'awaiting-details', 'meter reading', 'bolt'],
    ['Council tax', 168, partner.id, 2, 'payment-due', null, 'landmark'],
    ['Broadband', 32, me, 12, 'scheduled', null, 'wifi'],
    ['Water', 38.5, me, 18, 'scheduled', null, 'droplet'],
    ['Streaming', 10.99, partner.id, 22, 'sent', null, 'play']
  ];
  for (const [name, total, payer, inDays, status, detailsLabel, glyph] of bills) {
    const [b] = await rest('bills', {
      household_id: hid, name, glyph, total, payer_id: payer, due_date: day(inDays), frequency: 'Monthly',
      frequency_unit: 'month', frequency_count: 1, status, needs_details: Boolean(detailsLabel), details_label: detailsLabel, created_by: me
    }, token);
    const half = Math.round((total / 2) * 100) / 100;
    await rest('bill_shares', [
      { bill_id: b.id, household_id: hid, user_id: me, share: half },
      { bill_id: b.id, household_id: hid, user_id: partner.id, share: Math.round((total - half) * 100) / 100 }
    ], token);
  }
  const [loan] = await rest('lending', { household_id: hid, name: 'Takeaway', glyph: 'cart', total: 24, payer_id: me, occurred_on: day(-3), status: 'scheduled', created_by: me }, token);
  await rest('lending_shares', [{ lending_id: loan.id, household_id: hid, user_id: partner.id, share: 24 }], token);
  for (const text of ['Added Water, 38.50 a month', 'Shared the energy meter reading', 'Added Takeaway, 24.00']) {
    await rest('activity', { household_id: hid, user_id: me, text, tag: 'Added' }, token);
  }

  // Alex's private space — Yours.
  await call(`/rest/v1/private_settings?user_id=eq.${me}`, { method: 'PATCH', token, body: { income: 2150, payday: '28th', budget: 260, debt_module: true } });
  await rest('personal_bills', [
    { user_id: me, name: 'Phone', amount: 18, day: 3, glyph: 'phone' },
    { user_id: me, name: 'Gym', amount: 32, day: 1, glyph: 'gym' }
  ], token);
  await rest('debts', [
    { user_id: me, name: 'Credit card', kind: 'card', glyph: 'card', balance: 1840, apr: 22.9, min_payment: 55 },
    { user_id: me, name: 'Car loan', kind: 'loan', glyph: 'car', balance: 4200, apr: 7.4, min_payment: 160 }
  ], token);
}

/* ── the pictures ─────────────────────────────────────────────────── */
const SCREENS = ['home', 'bills', 'settle', 'alerts', 'yours', 'household'];
const KINDS = {
  phone: { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 1.5 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
};

let failures = 0;

async function photograph() {
  const { chromium } = await import('playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [kind, options] of Object.entries(KINDS)) {
    const context = await browser.newContext({ ...options, colorScheme: 'light' });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error(`  [${kind} page error] ${String(err.stack || err).slice(0, 1200)}`));
    page.on('console', (m) => { if (m.type() === 'error') console.error(`  [${kind} console] ${m.text().slice(0, 300)}`); });
    await page.goto(`${BASE}/android/onboarding`);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.fill('#signin-email', EMAIL);
    await page.fill('#signin-password', PASSWORD);
    await page.locator('form button[type="submit"]').click();
    await page.locator('nav[aria-label="Main"]').waitFor({ timeout: 45000 });
    for (const screen of SCREENS) {
      await page.goto(`${BASE}/android/${screen}`);
      try {
        await page.locator('nav[aria-label="Main"]').waitFor({ timeout: 30000 });
      } catch {
        // Keep what's on screen, say what it said, and carry on.
        await page.screenshot({ path: path.join(OUT, `failed-${kind}-${screen}.png`) });
        const said = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
        console.error(`  ${kind}/${screen} didn't load: ${said}`);
        failures++;
        continue;
      }
      await page.waitForTimeout(1500);
      const skip = page.getByRole('button', { name: 'Skip tour' });
      if (await skip.isVisible().catch(() => false)) await skip.click();
      const file = path.join(OUT, `${kind}-${screen}.png`);
      await page.screenshot({ path: file });
      console.log(`  ${path.relative(root, file)}`);
    }
    await context.close();
  }
  await browser.close();
}

await seed();
console.log('Seeded a made-up household (Flat 4: Alex Rivera and Sam Okafor).');
await photograph();
if (failures) {
  console.error(`${failures} screen(s) didn't load — see failed-*.png.`);
  process.exit(1);
}
