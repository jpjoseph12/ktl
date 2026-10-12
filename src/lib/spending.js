/* Reads a bank's transaction export (Monzo's CSV first and foremost) and
   finds what's worth knowing: where the money goes, what repeats, what
   changed, and what could realistically be cut.

   Runs entirely on the device. Nothing here touches the network or the
   database — the file is read, analysed in memory and forgotten. */

import { glyphFor } from './kettle';

const round2 = (n) => Math.round(n * 100) / 100;
const DAY = 86400000;

/* ── CSV ─────────────────────────────────────────────────────────── */

/* RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside
   quotes, a BOM, CRLF or LF. */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/* ── transactions ────────────────────────────────────────────────── */

/* Monzo's column names first; the rest let other UK banks' exports work
   too (Starling, and most "Date, Description, Amount" files). */
const COLUMNS = {
  date: ['date', 'transaction date', 'posting date', 'completed date'],
  name: ['name', 'counter party', 'merchant', 'payee', 'description', 'transaction description', 'reference'],
  amount: ['amount', 'amount (gbp)', 'value', 'amount(gbp)'],
  out: ['money out', 'paid out', 'debit', 'debit amount', 'out'],
  in: ['money in', 'paid in', 'credit', 'credit amount', 'in'],
  category: ['category', 'spending category'],
  type: ['type', 'transaction type']
};

function columnIndex(header, names) {
  const h = header.map((x) => x.trim().toLowerCase());
  for (const n of names) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

export function parseDate(s) {
  const t = String(s || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(Date.UTC(year, +m[2] - 1, +m[1]));
  }
  return null;
}

function parseMoney(s) {
  const t = String(s ?? '').replace(/[£,\s]/g, '');
  if (!t) return null;
  const n = Number(t.replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : null;
}

/* Money moved between your own pots or to savings isn't spending. */
const NOT_SPENDING_TYPE = /pot transfer|savings/i;
const NOT_SPENDING_CATEGORY = /^(savings|transfers|income)$/i;

export function readTransactions(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('That file has no transactions in it.');
  const header = rows[0];
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, columnIndex(header, names)]));
  if (col.date < 0 || col.name < 0 || (col.amount < 0 && col.out < 0)) {
    throw new Error('That doesn’t look like a bank export. In Monzo: Account → Export transactions → CSV.');
  }

  const txns = [];
  for (const r of rows.slice(1)) {
    const date = parseDate(r[col.date]);
    if (!date) continue;
    let amount = col.amount >= 0 ? parseMoney(r[col.amount]) : null;
    if (amount === null && col.out >= 0) {
      const out = parseMoney(r[col.out]) || 0;
      const inn = col.in >= 0 ? parseMoney(r[col.in]) || 0 : 0;
      amount = inn - Math.abs(out);
    }
    if (amount === null || amount === 0) continue;
    const name = String(r[col.name] || '').trim() || 'Unknown';
    const type = col.type >= 0 ? String(r[col.type] || '').trim() : '';
    const category = col.category >= 0 ? String(r[col.category] || '').trim() : '';
    txns.push({
      date,
      name,
      type,
      category: category || 'Uncategorised',
      amount: round2(amount),
      spending: amount < 0 && !NOT_SPENDING_TYPE.test(type) && !NOT_SPENDING_CATEGORY.test(category)
    });
  }
  if (!txns.length) throw new Error('No transactions could be read from that file.');
  return txns.sort((a, b) => a.date - b.date);
}

/* ── analysis ────────────────────────────────────────────────────── */

/* "AMAZON* 1A2B3C LONDON" and "Amazon" are the same merchant. */
export function merchantKey(name) {
  return String(name).toLowerCase()
    .replace(/[*#].*$/, '')
    .replace(/\b(ltd|limited|plc|uk|gb|london|www|com|co)\b/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ').slice(0, 3).join(' ') || String(name).toLowerCase();
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const CADENCES = [
  { id: 'weekly', min: 6, max: 8, perMonth: 52 / 12, minCount: 3, label: 'a week' },
  { id: 'fortnightly', min: 13, max: 16, perMonth: 26 / 12, minCount: 3, label: 'a fortnight' },
  { id: 'monthly', min: 26, max: 35, perMonth: 1, minCount: 2, label: 'a month' },
  { id: 'quarterly', min: 85, max: 95, perMonth: 1 / 3, minCount: 2, label: 'a quarter' },
  { id: 'yearly', min: 350, max: 380, perMonth: 1 / 12, minCount: 2, label: 'a year' }
];

function nameMatches(a, b) {
  const ka = merchantKey(a);
  const kb = merchantKey(b);
  if (!ka || !kb) return false;
  return ka === kb || ka.includes(kb) || kb.includes(ka) || ka.split(' ')[0] === kb.split(' ')[0];
}

/* The weekly shop or a regular takeaway can look as steady as a
   subscription, but it isn't one: nothing to cancel, no price to
   renegotiate. Those categories only count when it's a Direct Debit. */
const EVERYDAY = /groceries|eating out|takeaway|shopping|cash|transport|holidays|fuel/i;

function findRecurring(groups, end, tracked) {
  const out = [];
  for (const [key, list] of groups) {
    if (EVERYDAY.test(list[0].category) && !list.some((t) => /direct debit/i.test(t.type))) continue;
    const amounts = list.map((t) => -t.amount);
    const typical = median(amounts);
    const steady = amounts.filter((a) => Math.abs(a - typical) <= Math.max(1, typical * 0.2)).length / amounts.length >= 0.7;
    if (!steady) continue;
    const gaps = list.slice(1).map((t, i) => (t.date - list[i].date) / DAY);
    let cadence = null;
    if (gaps.length) {
      const g = median(gaps);
      cadence = CADENCES.find((c) => g >= c.min && g <= c.max && list.length >= c.minCount) || null;
    }
    // A single Direct Debit in a short export is still almost certainly monthly.
    if (!cadence && list.length === 1 && /direct debit/i.test(list[0].type)) cadence = CADENCES[2];
    if (!cadence) continue;
    const last = list[list.length - 1];
    const sinceLast = (end - last.date) / DAY;
    const name = last.name;
    out.push({
      key,
      name,
      amount: round2(-last.amount),
      typical: round2(typical),
      cadence: cadence.id,
      cadenceLabel: cadence.label,
      monthly: round2(typical * cadence.perMonth),
      count: list.length,
      lastDate: last.date,
      day: last.date.getUTCDate(),
      active: sinceLast <= cadence.max * 1.5,
      glyph: glyphFor(name),
      tracked: tracked.some((t) => nameMatches(t, name)),
      previous: list.length > 1 ? round2(-list[list.length - 2].amount) : null
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

/* `tracked` is every bill name KTL already knows about — your own and the
   household's — so a payment that's already accounted for isn't
   "discovered" all over again. */
export function analyseSpending(txns, { tracked = [] } = {}) {
  const spend = txns.filter((t) => t.spending);
  const start = txns[0].date;
  const end = txns[txns.length - 1].date;
  const days = Math.max(1, Math.round((end - start) / DAY) + 1);
  const months = Math.max(1, days / 30.44);
  const perMonth = (total) => round2(total / months);

  const spent = round2(spend.reduce((s, t) => s - t.amount, 0));
  const incoming = round2(txns.filter((t) => t.amount > 0 && !NOT_SPENDING_TYPE.test(t.type)).reduce((s, t) => s + t.amount, 0));
  const setAside = round2(txns.filter((t) => t.amount < 0 && !t.spending).reduce((s, t) => s - t.amount, 0));

  const byCat = new Map();
  for (const t of spend) {
    const c = byCat.get(t.category) || { category: t.category, total: 0, count: 0 };
    c.total -= t.amount;
    c.count++;
    byCat.set(t.category, c);
  }
  const categories = [...byCat.values()]
    .map((c) => ({ ...c, total: round2(c.total), monthly: perMonth(c.total), share: spent ? c.total / spent : 0 }))
    .sort((a, b) => b.total - a.total);

  const groups = new Map();
  for (const t of spend) {
    const k = merchantKey(t.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const merchants = [...groups.entries()]
    .map(([key, list]) => {
      const total = round2(list.reduce((s, t) => s - t.amount, 0));
      return { key, name: list[list.length - 1].name, total, count: list.length, monthly: perMonth(total) };
    })
    .sort((a, b) => b.total - a.total);

  const recurring = findRecurring(groups, end, tracked);
  const recurringKeys = new Set(recurring.map((r) => r.key));
  const findings = [];

  // Regular payments KTL doesn't know about yet.
  for (const r of recurring.filter((x) => x.active && !x.tracked)) {
    findings.push({
      id: `untracked:${r.key}`,
      kind: 'untracked',
      title: `${r.name} — ${money(r.amount)} ${r.cadenceLabel}`,
      detail: 'A regular payment KTL doesn’t know about yet.',
      label: r.name,
      monthly: r.monthly,
      recurring: r
    });
  }

  // More than one streaming service.
  const streaming = recurring.filter((r) => r.active && (r.glyph === 'music' || r.glyph === 'play'));
  if (streaming.length >= 2) {
    const cheapest = [...streaming].sort((a, b) => a.monthly - b.monthly)[0];
    findings.push({
      id: 'streaming',
      kind: 'overlap',
      title: `${streaming.length} streaming subscriptions`,
      detail: `${streaming.map((s) => s.name).join(', ')} — ${money(round2(streaming.reduce((s, r) => s + r.monthly, 0)))} a month together.`,
      label: `Drop ${cheapest.name}`,
      monthly: cheapest.monthly
    });
  }

  // Price rises on something regular.
  for (const r of recurring.filter((x) => x.active && x.previous && x.amount - x.previous >= Math.max(1, x.previous * 0.05))) {
    findings.push({
      id: `rise:${r.key}`,
      kind: 'rise',
      title: `${r.name} went up`,
      detail: `From ${money(r.previous)} to ${money(r.amount)}. Worth checking for a cheaper plan.`,
      label: `${r.name} price rise`,
      monthly: round2((r.amount - r.previous) * (r.monthly / r.typical || 1))
    });
  }

  // Little and often — easy to miss, adds up.
  for (const [key, list] of groups) {
    if (recurringKeys.has(key)) continue;
    const small = list.filter((t) => -t.amount <= 15);
    if (small.length < 6 || small.length / list.length < 0.8) continue;
    const monthly = perMonth(small.reduce((s, t) => s - t.amount, 0));
    if (monthly < 20) continue;
    const name = list[list.length - 1].name;
    findings.push({
      id: `often:${key}`,
      kind: 'often',
      title: `${name}, ${small.length} times`,
      detail: `${money(monthly)} a month, a few pounds at a time. Halving it frees ${money(round2(monthly / 2))}.`,
      label: `Half as much at ${name}`,
      monthly: round2(monthly / 2)
    });
  }

  // A category running well above its usual level lately.
  if (days >= 75) {
    const recentFrom = new Date(end.getTime() - 30 * DAY);
    const earlierMonths = Math.max(1, (recentFrom - start) / DAY / 30.44);
    for (const c of categories) {
      const recent = round2(spend.filter((t) => t.category === c.category && t.date > recentFrom).reduce((s, t) => s - t.amount, 0));
      const usual = round2(spend.filter((t) => t.category === c.category && t.date <= recentFrom).reduce((s, t) => s - t.amount, 0) / earlierMonths);
      if (usual > 0 && recent - usual >= 30 && recent >= usual * 1.4) {
        findings.push({
          id: `spike:${c.category}`,
          kind: 'spike',
          title: `${c.category} is up`,
          detail: `${money(recent)} in the last 30 days against a usual ${money(usual)}.`,
          label: `${c.category} back to usual`,
          monthly: round2(recent - usual)
        });
      }
    }
  }

  // Charged twice?
  const seen = new Map();
  for (const t of spend) {
    if (-t.amount < 2) continue;
    const k = `${merchantKey(t.name)}|${t.amount}|${t.date.getTime()}`;
    seen.set(k, [...(seen.get(k) || []), t]);
  }
  for (const [k, list] of seen) {
    if (list.length < 2) continue;
    findings.push({
      id: `double:${k}`,
      kind: 'double',
      title: `${list[0].name} charged ${list.length} times`,
      detail: `${money(-list[0].amount)} each on ${list[0].date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}. Worth checking it wasn’t a mistake.`,
      monthly: 0
    });
  }

  // Eating out and takeaways — the most common place people find money.
  const eating = categories.find((c) => /eating out|takeaway|restaurant/i.test(c.category));
  if (eating && eating.monthly >= 80 && !findings.some((f) => f.id === `spike:${eating.category}`)) {
    findings.push({
      id: 'eating',
      kind: 'habit',
      title: `Eating out: ${money(eating.monthly)} a month`,
      detail: `Cutting it by a quarter frees ${money(round2(eating.monthly / 4))} a month.`,
      label: 'Eat out a bit less',
      monthly: round2(eating.monthly / 4)
    });
  }

  const order = { double: 0, rise: 1, untracked: 2, overlap: 3, spike: 4, often: 5, habit: 6 };
  findings.sort((a, b) => order[a.kind] - order[b.kind] || b.monthly - a.monthly);

  return {
    from: start,
    to: end,
    days,
    months: round2(months),
    count: txns.length,
    spent,
    spentMonthly: perMonth(spent),
    incoming,
    setAside,
    categories,
    merchants: merchants.slice(0, 8),
    recurring,
    findings
  };
}

function money(n) {
  return '£' + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
