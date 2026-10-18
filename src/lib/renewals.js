/* KTL — when a bill's deal ends, and how far ahead to start looking.
 *
 * Pure, like reminders.js: the bill screens, the reminder planner and the
 * deal card all read the same leads from here.
 *
 * The leads follow what each kind of contract allows: energy suppliers let
 * you switch penalty-free in the last 49 days of a fixed tariff, so six
 * weeks leaves time to compare; broadband and mobile renewal notices land
 * 10–40 days out; insurance quotes are usually cheapest about three weeks
 * before renewal.
 */

export const RENEWAL_KINDS = [
  { id: 'energy', label: 'Energy', lead: 42, why: 'You can usually switch without exit fees in the last 49 days of a fixed tariff.' },
  { id: 'broadband', label: 'Broadband', lead: 28, why: 'Out-of-contract prices often jump — haggling or switching before the end avoids that.' },
  { id: 'mobile', label: 'Mobile', lead: 28, why: 'Once the contract ends, a SIM-only deal is often much cheaper.' },
  { id: 'insurance', label: 'Insurance', lead: 21, why: 'Quotes tend to be cheapest about three weeks before renewal.' },
  { id: 'other', label: 'Something else', lead: 14, why: 'A reminder two weeks before gives you time to compare.' }
];

const BY_ID = Object.fromEntries(RENEWAL_KINDS.map((k) => [k.id, k]));

export const renewalKind = (id) => BY_ID[id] || BY_ID.other;

/* A sensible kind from what the bill is called and its icon — the same
   guess the server makes when a bill has no kind saved. */
export function guessRenewalKind(name = '', glyph = '') {
  const t = String(name).toLowerCase();
  if (/energy|\bgas\b|electric|octopus|\bedf\b|e\.?on\b|\bovo\b|scottish power|utility warehouse/.test(t)) return 'energy';
  if (/broadband|internet|fibre|fiber|wi-?fi|\bbt\b|virgin media|talktalk|plusnet|hyperoptic|\bsky\b/.test(t)) return 'broadband';
  if (/insur|\bcover\b|protection|warranty|aviva|direct line|admiral|churchill/.test(t)) return 'insurance';
  if (/phone|mobile|\bsim\b|\bee\b|\bo2\b|vodafone|\bthree\b|giffgaff|voxi|lebara/.test(t)) return 'mobile';
  return { bolt: 'energy', flame: 'energy', wifi: 'broadband', phone: 'mobile', shield: 'insurance' }[glyph] || 'other';
}

function localDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* Whole days from today to the date (negative once it's passed). */
export function daysUntil(iso, now = new Date()) {
  if (!iso) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((localDate(iso) - today) / 86_400_000);
}

/* Is it time to look? From the lead date until a week after the end. */
export function inRenewalWindow(bill, now = new Date()) {
  const days = daysUntil(bill?.renewsOn, now);
  if (days === null) return false;
  return days <= renewalKind(bill.renewalKind).lead && days >= -7;
}

export function formatRenewal(iso) {
  return localDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* One reminder per bill with an end date, `lead` days before it at 09:00
   (moved out of quiet hours). `ids` keeps shared and personal bills from
   ever sharing a notification id. Past ones are dropped by the caller. */
export function renewalReminders(bills = [], { applyQuietHours, reminderId, quietFrom, quietTo, scope = 'shared' } = {}) {
  return bills
    .filter((b) => b.renewsOn && !b.endedOn)
    .map((b) => {
      const kind = renewalKind(b.renewalKind);
      const at = localDate(b.renewsOn);
      at.setDate(at.getDate() - kind.lead);
      at.setHours(9, 0, 0, 0);
      const when = formatRenewal(b.renewsOn);
      return {
        id: reminderId(`${scope}:${b.id}:renewal:${b.renewsOn}`),
        kind: 'renewal',
        billId: b.id,
        title: `Time to check ${b.name}`,
        sub: `${b.name} · deal ends ${when}, ${Math.round(kind.lead / 7)} weeks’ notice`,
        body: `Your ${b.name} deal ends on ${when}. ${kind.why}`,
        at: applyQuietHours ? applyQuietHours(at, quietFrom, quietTo) : at
      };
    });
}
