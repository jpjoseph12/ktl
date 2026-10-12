/* KTL — the private half of the app.
 *
 * PRIVACY BOUNDARY. This module owns everything that belongs to one person and
 * to nobody else: take-home pay, credit cards, debts, the repayment plan.
 *
 *   • It is stored under its own key (PRIVATE_STORE), never in the household
 *     store that lib/kettle.js + KettleContext read and write.
 *   • Data flows one way only. This file reads the shared household to learn
 *     your share of the bills. Nothing in here is ever written back, published,
 *     or exposed to the other person's device.
 *   • The whole debt side can be switched off (state.debtModule = false), which
 *     leaves KTL tracking income and household costs only.
 *
 * The payoff simulation is ported from the user's own debt-repayment planner
 * (snowball / avalanche, promotional 0% periods, monthly interest accrual),
 * so the dates here are computed, not decorative.
 */
import { money } from './kettle';

export const PRIVATE_STORE = 'kettle.me.v1';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function num(v) {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return isFinite(n) ? n : 0;
}
export function round(n) {
  return Math.round(n * 100) / 100;
}

export function dateAfter(months, short) {
  const today = new Date();
  const i = today.getMonth() + months;
  const names = short ? SHORT : MONTHS;
  const y = today.getFullYear() + Math.floor(i / 12);
  return names[((i % 12) + 12) % 12] + ' ' + (short ? String(y).slice(2) : y);
}

/* The one line every month-stepping calculation in this file must agree
   on — kept as its own function rather than duplicated so a future
   rate-model tweak can't be made in one place (simulate) and forgotten in
   another (projectedDebt, below). */
function accrue(bal, apr, promoActive) {
  return bal * (promoActive ? 0 : apr / 1200);
}

/* Monthly payoff simulation. */
export function simulate(debts, monthly, strategy) {
  const ds = debts
    .map((d) => ({ id: d.id, name: d.name, bal: num(d.balance), apr: num(d.apr), min: num(d.min), promo: num(d.promo) }))
    .filter((d) => d.bal > 0);
  if (!ds.length) return { months: 0, payoff: {}, order: [], interest: 0, stalled: false };

  const order = ds.slice().sort((a, b) => (strategy === 'avalanche' ? b.apr - a.apr : a.bal - b.bal));
  const payoff = {};
  let interest = 0, m = 0, stalled = false;

  for (;;) {
    if (m >= 480) { stalled = true; break; }
    m++;
    ds.forEach((d) => {
      if (d.bal <= 0) return;
      const i = accrue(d.bal, d.apr, m <= d.promo);
      d.bal += i;
      interest += i;
    });
    let pool = monthly;
    order.forEach((d) => {
      if (d.bal <= 0 || pool <= 0) return;
      const p = Math.min(d.bal, d.min, pool);
      d.bal -= p; pool -= p;
    });
    order.forEach((d) => {
      if (pool <= 0 || d.bal <= 0) return;
      const p = Math.min(d.bal, pool);
      d.bal -= p; pool -= p;
    });
    ds.forEach((d) => {
      if (d.bal <= 0.01 && !payoff[d.id]) { payoff[d.id] = m; d.bal = 0; }
    });
    if (ds.every((d) => d.bal <= 0.01)) break;
  }
  return { months: m, payoff, order, interest, stalled };
}

/* Whole calendar months elapsed between an ISO timestamp and "today",
   floored — a partial month never counts (45 days since confirmation is
   1 month elapsed, not 1.5). Clamped to >= 0 so clock skew (or a debt
   confirmed moments ago) can never project backward. */
export function monthsElapsed(sinceIso, today) {
  const since = new Date(sinceIso);
  if (isNaN(since.getTime())) return 0;
  const now = today || new Date();
  let months = (now.getFullYear() - since.getFullYear()) * 12 + (now.getMonth() - since.getMonth());
  if (now.getDate() < since.getDate()) months -= 1;
  return Math.max(0, months);
}

/* Assumes at least the minimum was paid every month since this debt's
   balance was last confirmed, and rolls it forward to "today" using the
   same interest-then-payment order simulate() uses (via the shared
   accrue() helper, so the two formulas can't drift apart). Unlike
   simulate()'s `m <= d.promo` (a loop-iteration count, meaningless outside
   a fresh simulation), promo here is a real countdown decremented once
   per elapsed calendar month, since this walks actual time. A debt that
   would already be paid off by the projection returns balance 0, never
   negative — the caller (payoffPlan) decides what a fully-projected
   payoff means for display. Partial months are floored by
   monthsElapsed(), never estimated. */
export function projectedDebt(debt, today) {
  const months = monthsElapsed(debt.confirmedAt, today);
  const apr = num(debt.apr);
  const min = num(debt.min);
  let bal = num(debt.balance);
  let promo = Math.max(0, Math.round(num(debt.promo)));
  if (months <= 0 || bal <= 0) {
    return { balance: round(Math.max(0, bal)), promo };
  }
  for (let i = 0; i < months && bal > 0; i++) {
    bal += accrue(bal, apr, promo > 0);
    bal -= Math.min(bal, min);
    if (promo > 0) promo -= 1;
  }
  return { balance: round(Math.max(0, bal)), promo };
}

/* ── defaults ────────────────────────────────────────────────────────
   Demonstration figures. Every one of them is editable in the app. */
export const DEFAULTS = {
  debtModule: true,
  income: 2640.00,
  payday: '28th',
  budget: 520,
  strategy: 'snowball',
  emergencySaved: 0,
  emergencyMonths: 3,
  debts: [
    { id: 'barclaycard', name: 'Barclaycard Platinum', kind: 'Credit card', glyph: 'card',
      balance: 2480.00, apr: 24.9, min: 62.00, promo: 6 },
    { id: 'halifax', name: 'Halifax Clarity', kind: 'Credit card', glyph: 'card',
      balance: 1340.00, apr: 22.9, min: 34.00, promo: 0 },
    { id: 'zopa', name: 'Zopa car loan', kind: 'Loan', glyph: 'train',
      balance: 4850.00, apr: 9.9, min: 186.00, promo: 0 },
    { id: 'klarna', name: 'Klarna Pay in 3', kind: 'Buy now, pay later', glyph: 'cart',
      balance: 220.00, apr: 0, min: 55.00, promo: 0 }
  ],
  /* Bills that are yours alone — the ones that never belonged in the
     household split. Recurring commitments, not balances being paid down:
     anything with a balance belongs under debts. */
  personal: [
    { id: 'mobile', name: 'EE mobile', kind: 'Phone', glyph: 'phone', amount: 28.00, day: 12 },
    { id: 'car-insurance', name: 'Admiral car insurance', kind: 'Insurance', glyph: 'shield', amount: 41.60, day: 3 },
    { id: 'gym', name: 'PureGym Camden', kind: 'Gym', glyph: 'gym', amount: 24.99, day: 1 }
  ],
  /* Money you could free up. Two are your half of a real household bill —
     modelling them here does not cancel anything on the shared side. */
  savings: [
    { id: 'netflix', label: 'Cancel Netflix Premium', detail: 'Your half of £17.99 · shared bill', amount: 9.00, shared: true, applied: false },
    { id: 'spotify', label: 'Drop Spotify Duo', detail: 'Your half of £19.99 · shared bill', amount: 9.99, shared: true, applied: false },
    { id: 'lunch', label: 'Lunch from home', detail: 'Your own estimate', amount: 60.00, shared: false, applied: false }
  ]
};

export function defaultState() {
  return {
    debtModule: DEFAULTS.debtModule,
    income: DEFAULTS.income,
    payday: DEFAULTS.payday,
    budget: DEFAULTS.budget,
    strategy: DEFAULTS.strategy,
    emergencySaved: DEFAULTS.emergencySaved,
    emergencyMonths: DEFAULTS.emergencyMonths,
    debts: DEFAULTS.debts.map((d) => ({ ...d })),
    personal: DEFAULTS.personal.map((p) => ({ ...p })),
    savings: DEFAULTS.savings.map((s) => ({ ...s }))
  };
}

/* ── personal bills ──────────────────────────────────────────────── */
export function ordinal(n) {
  n = Math.max(1, Math.min(31, Math.round(num(n))));
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
}

/* glyphFor/kindFor moved to lib/kettle.js — it's a plain name-to-icon
   categorizer with no private data in it, and KettleContext needs the
   exact same detection for shared bills (so a "Netflix" bill gets a
   'play' glyph there too, not just here). Re-exported from here so
   nothing importing them from lib/private breaks. */
export { glyphFor, kindFor } from './kettle';

export function personalTotal(state) {
  return round(state.personal.reduce((t, p) => t + num(p.amount), 0));
}
export function personalSorted(state) {
  return state.personal.slice().sort((a, b) => num(a.day) - num(b.day));
}

/* ── derived plan ────────────────────────────────────────────────── */
export function payoffPlan(state) {
  const today = new Date();
  // Project every debt to "today" first, assuming the minimum was paid
  // each month since it was last confirmed — everything below (dates,
  // interest, the .rate chip, minTotal, totalOwed) reads off this
  // projected view, never the raw stored balance/promo directly, so the
  // plan stays current between check-ins instead of frozen at whatever
  // was last typed in.
  /* A cleared debt is finished business — it keeps its row as a record,
     but it is not part of the plan and must not drag the payoff date or
     the totals around. */
  const projected = state.debts.filter((d) => !d.clearedAt).map((d) => ({
    ...d,
    ...projectedDebt(d, today),
    monthsSinceConfirmed: monthsElapsed(d.confirmedAt, today)
  }));
  const active = projected.filter((d) => d.balance > 0);
  // A debt the projection thinks is already paid off must still be SHOWN
  // (per product decision) rather than silently vanishing — simulate()
  // would otherwise just filter it out like any other zero-balance debt.
  const clearedByProjection = projected.filter((d) => d.balance <= 0);

  let freed = 0;
  state.savings.forEach((s) => { if (s.applied) freed += s.amount; });
  const working = num(state.budget) + freed;
  const minTotal = active.reduce((t, d) => t + num(d.min), 0);
  const totalOwed = projected.reduce((t, d) => t + num(d.balance), 0);

  const run = simulate(active, working, state.strategy);
  const base = simulate(active, minTotal, state.strategy);

  let compareLine;
  if (run.stalled) {
    compareLine = 'At this budget the balances stop falling — interest outruns the payments.';
  } else if (base.stalled) {
    compareLine = 'Minimums alone would never clear it. This plan does.';
  } else {
    const saved = base.months - run.months;
    compareLine = saved > 0
      ? saved + (saved === 1 ? ' month' : ' months') + ' sooner than minimums only (' + dateAfter(base.months) + ')'
      : 'Same as the minimum-only path — anything above the minimums pulls the date in';
  }

  let warning = null;
  if (run.stalled) {
    warning = 'This budget is below what the interest adds each month. Raise it, or free something up.';
  } else if (working < minTotal) {
    warning = 'You are ' + round(minTotal - working) + ' short of the minimums due — some accounts would fall behind.';
  }

  const progressPct = (base.stalled || run.stalled || !base.months)
    ? 12
    : Math.max(6, Math.min(100, Math.round((1 - run.months / base.months) * 100)));

  return {
    run, base,
    freed: round(freed),
    working: round(working),
    minTotal: round(minTotal),
    totalOwed: round(totalOwed),
    // A stalled run means payments never outpace interest — the model has
    // the balance compounding, unchecked, for the full 480-month cap, so
    // the "interest paid" figure it produces is not a real number (tens of
    // millions of pounds), just an artifact of where the simulation gave
    // up. There's no meaningful finite answer to show, so don't show one.
    interest: run.stalled ? null : round(run.interest),
    months: run.months,
    stalled: run.stalled,
    compareLine,
    warning,
    progressPct,
    freeDate: run.stalled ? 'Not on this plan' : dateAfter(run.months),
    freeDateShort: run.stalled ? '—' : dateAfter(run.months, true),
    rows: run.order.map((d, i) => {
      const when = run.payoff[d.id];
      let src = null;
      active.forEach((x) => { if (x.id === d.id) src = x; });
      const balance = src ? num(src.balance) : 0;
      const apr = src ? num(src.apr) : 0;
      const promo = src ? num(src.promo) : 0;
      const rate = rateInfo({ balance, apr, promo });
      return {
        id: d.id,
        rank: i + 1,
        name: d.name,
        kind: src ? src.kind : '',
        glyph: src ? src.glyph : 'card',
        balance,
        apr,
        promo,
        min: src ? num(src.min) : 0,
        // Full chip/band/detail/cost bundle for the row — same shape the
        // add/edit sheet's live preview uses, so the list and the sheet
        // can never describe the same account differently.
        rate,
        // Compat: the plain number alone, for callers not yet using the
        // richer `rate` object. Not the same as the lifetime "interest
        // along the way" total on the overall plan — this is per-debt, so
        // it stays a small, sane number even when the plan as a whole is
        // close to stalling.
        monthlyInterest: rate.monthly,
        isFocus: i === 0,
        clearedIn: when || null,
        date: when ? dateAfter(when) : '—',
        dateShort: when ? dateAfter(when, true) : '—',
        monthsSinceConfirmed: src ? src.monthsSinceConfirmed : 0,
        needsCheckIn: src ? src.monthsSinceConfirmed >= 3 : false,
        projectedCleared: false
      };
    }).concat(clearedByProjection.map((d) => ({
      id: d.id,
      rank: null,
      name: d.name,
      kind: d.kind,
      glyph: d.glyph,
      balance: 0,
      apr: num(d.apr),
      promo: 0,
      min: num(d.min),
      rate: rateInfo({ balance: 0, apr: 0, promo: 0 }),
      monthlyInterest: 0,
      isFocus: false,
      clearedIn: 0,
      date: dateAfter(0),
      dateShort: dateAfter(0, true),
      monthsSinceConfirmed: d.monthsSinceConfirmed,
      needsCheckIn: true,
      projectedCleared: true
    })))
  };
}

/* ── what you can expect after bills and cards ───────────────────── */
/* householdShare crosses the privacy boundary — it's the caller's job
   (PrivateContext, which sits inside KettleProvider) to compute it from
   the live shared bills and pass it in. Nothing in this file ever reads
   household data itself. */
export function leftover(state, householdShareAmount) {
  const income = num(state.income);
  const household = round(householdShareAmount || 0);
  const personal = personalTotal(state);
  const p = payoffPlan(state);
  const debt = state.debtModule ? p.working : 0;
  const left = income - household - personal - debt;
  const pct = (n) => (income > 0 ? Math.round((n / income) * 100) : 0);
  return {
    income: round(income),
    household: round(household),
    personal,
    debt: round(debt),
    minimums: round(p.minTotal),
    committed: round(household + personal + debt),
    left: round(left),
    weekly: round((left * 12) / 52),
    daily: round((left * 12) / 365),
    pctHousehold: pct(household),
    pctPersonal: pct(personal),
    pctDebt: pct(debt),
    pctLeft: income > 0 ? Math.max(0, Math.round((left / income) * 100)) : 0
  };
}

/* A non-blocking sanity check on a "towards debt" figure before it's
   saved. There's no fair universal ceiling to hard-block against: a fixed
   buffer unfairly squeezes a low income (holding back £150 might be a
   third of what someone on minimum wage has left), and a flat percentage
   overprotects a high one (20% held back means nothing to someone with
   thousands spare). So this only ever warns, using what would actually be
   left after it — never blocks, unlike the separate minimum-payment floor
   in payoffPlan(), which is a hard rule because minimums are contractually
   due regardless of how "realistic" that leaves the rest of the budget. */
export function debtBudgetWarning(state, householdShareAmount, budgetValue) {
  const income = num(state.income);
  const household = round(householdShareAmount || 0);
  const personal = personalTotal(state);
  const projectedLeft = round(income - household - personal - num(budgetValue));
  if (projectedLeft < 0) {
    return 'That’s ' + money(Math.abs(projectedLeft)) + ' more than you have coming in after your other costs.';
  }
  if (projectedLeft < 50) {
    return 'This leaves you just ' + money(projectedLeft) + ' spare each month — worth double-checking it’s realistic.';
  }
  return null;
}

/* ── emergency fund ──────────────────────────────────────────────── */
/* "Outgoings" for this purpose means what you'd still have to cover if
   income stopped tomorrow: your share of the household bills, your own
   personal bills, and — if the debt module is on — the minimum payments
   you're on the hook for (not the extra you're choosing to overpay). */
export function emergencyFundOutgoings(state, householdShareAmount) {
  const household = round(householdShareAmount || 0);
  const personal = personalTotal(state);
  // A cleared debt has no minimum left to cover.
  const minimums = state.debtModule
    ? round(state.debts.filter((d) => !d.clearedAt).reduce((t, d) => t + num(d.min), 0))
    : 0;
  return round(household + personal + minimums);
}

export function emergencyFundPlan(state, householdShareAmount) {
  const monthlyOutgoings = emergencyFundOutgoings(state, householdShareAmount);
  const months = num(state.emergencyMonths) || 3;
  const target = round(monthlyOutgoings * months);
  const saved = round(num(state.emergencySaved));
  const remaining = round(Math.max(0, target - saved));
  const progressPct = target > 0 ? Math.max(0, Math.min(100, Math.round((saved / target) * 100))) : 0;
  const coveredMonths = monthlyOutgoings > 0 ? round(saved / monthlyOutgoings) : 0;
  return { monthlyOutgoings, months, target, saved, remaining, progressPct, coveredMonths };
}

/* Payday is free text ("28th", "Last Friday") so only a leading day-of-month
   number can be nudged on reliably. Returns null when it can't be parsed,
   otherwise how many days have passed since the most recent payday
   (0 = today), wrapping cyclically so a payday late in a short month still
   lands sensibly the next month. */
export function daysSincePayday(paydayStr, today) {
  const day = parseInt(paydayStr, 10);
  if (!day || day < 1 || day > 31) return null;
  const now = today || new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const effectiveDay = Math.min(day, daysInMonth);
  const diff = now.getDate() - effectiveDay;
  return diff >= 0 ? diff : diff + daysInMonth;
}

/* ── standard APR reference (credit cards, loans, BNPL) ─────────────
   Publicly-known TYPICAL/representative rates for common UK providers —
   a data-entry convenience only, never the user's actual rate. Real APR
   depends on the specific card/loan product, promotional terms and the
   individual's own credit history, and these figures drift as providers
   reprice, so every suggestion this powers must be shown next to an
   explicit "this is a general rate, check your real statement" warning
   in the UI — never silently applied as fact. */
export const STANDARD_APR = [
  { pattern: /barclaycard/i, label: 'Barclaycard', apr: 28.9 },
  { pattern: /halifax/i, label: 'Halifax', apr: 24.9 },
  { pattern: /\bmbna\b/i, label: 'MBNA', apr: 24.9 },
  { pattern: /amex|american express/i, label: 'American Express', apr: 29.9 },
  { pattern: /capital one/i, label: 'Capital One', apr: 34.9 },
  { pattern: /\baqua\b/i, label: 'Aqua', apr: 39.9 },
  { pattern: /vanquis/i, label: 'Vanquis', apr: 42.9 },
  { pattern: /tesco/i, label: 'Tesco Bank', apr: 24.9 },
  { pattern: /natwest/i, label: 'NatWest', apr: 12.9 },
  { pattern: /santander/i, label: 'Santander', apr: 24.9 },
  { pattern: /hsbc/i, label: 'HSBC', apr: 29.9 },
  { pattern: /nationwide/i, label: 'Nationwide', apr: 24.9 },
  { pattern: /virgin money/i, label: 'Virgin Money', apr: 24.9 },
  { pattern: /john lewis|waitrose/i, label: 'John Lewis Partnership Card', apr: 29.9 },
  { pattern: /marks (and|&) spencer|\bm ?& ?s\b/i, label: 'M&S', apr: 24.9 },
  { pattern: /argos/i, label: 'Argos Pay', apr: 34.9, note: 'formerly Argos Card, now provided by NewDay' },
  { pattern: /\bvery\b|littlewoods/i, label: 'Very / Littlewoods', apr: 39.9 },
  { pattern: /lloyds/i, label: 'Lloyds', apr: 24.9 },
  { pattern: /first direct/i, label: 'First Direct', apr: 24.9 },
  { pattern: /zopa/i, label: 'Zopa loan', apr: 22.9 },
  {
    pattern: /currys|\byourplan\b/i, label: 'Currys YourPlan', apr: 29.9,
    note: 'Currys also offers 0% on some purchases up to 12 months — check which plan you actually have'
  },
  { pattern: /\bnextpay\b|\bnext (card|account|credit)\b/i, label: 'Next (nextpay)', apr: 24.9 },
  {
    pattern: /klarna/i, label: 'Klarna Pay in 3/30', apr: 0,
    note: 'standard short-term Klarna is interest-free — only their longer financing plans charge APR'
  },
  { pattern: /clearpay/i, label: 'Clearpay', apr: 0, note: 'Clearpay’s standard instalments are interest-free' },
  { pattern: /laybuy/i, label: 'Laybuy', apr: 0, note: 'Laybuy’s standard instalments are interest-free' },
  { pattern: /paypal credit/i, label: 'PayPal Credit', apr: 23.9 },
  { pattern: /paypal pay in 3/i, label: 'PayPal Pay in 3', apr: 0, note: 'PayPal’s Pay in 3 is interest-free' }
];

export function standardAprFor(name) {
  const t = String(name || '').trim();
  if (!t) return null;
  return STANDARD_APR.find((entry) => entry.pattern.test(t)) || null;
}

/* ── how a rate is presented ──────────────────────────────────────────
   One place decides what an interest rate says and how loudly, so the
   debt list, the add/edit sheet's live preview, and anywhere else showing
   a rate can never describe the same account differently. `band` only
   tints the chip — the figure itself is always spelled out in `label`, so
   the meaning never rests on colour alone. Ported from the design
   prototype's scripts/private.js (rateInfo) — keep the two in sync;
   see the design-sync skill. */
export function rateInfo(d) {
  const apr = num(d && d.apr);
  const promo = num(d && d.promo);
  const balance = num(d && d.balance);
  const monthly = apr > 0 && promo <= 0 && balance > 0 ? round((balance * apr) / 1200) : 0;
  let out;

  if (promo > 0) {
    const mo = promo === 1 ? 'month' : 'months';
    out = {
      band: 'promo',
      label: '0% · ' + promo + ' mo left',
      detail: apr > 0
        ? 'No interest for ' + promo + ' more ' + mo + ', then ' + apr.toFixed(1) + '% APR.'
        : 'No interest for ' + promo + ' more ' + mo + '.',
      monthly: 0
    };
  } else if (apr <= 0) {
    out = { band: 'zero', label: '0% APR', detail: 'No interest on this one.', monthly: 0 };
  } else {
    out = {
      band: apr < 10 ? 'low' : apr < 20 ? 'mid' : 'high',
      label: apr.toFixed(1) + '% APR',
      detail: monthly > 0
        ? 'About ' + money(monthly) + ' a month in interest at this balance.'
        : apr.toFixed(1) + '% a year on whatever is left owing.',
      monthly
    };
  }

  // The list's compact form of the same fact the sheet spells out: what
  // carrying this balance costs for a month, short enough to sit under
  // the balance without wrapping.
  out.cost = out.monthly > 0 ? '+' + money(out.monthly) + '/mo' : 'no interest';
  return out;
}

export function debtBadge(d) { return rateInfo(d).label; }

/* Compat wrapper — prefer rateInfo(d).monthly in new code, since it also
   carries the band/label/detail the UI needs alongside the raw number. */
export function monthlyInterestFor(d) { return rateInfo(d).monthly; }

/* How many months sooner debt-free if `extraAmount` a month went to debt
   on top of the current plan's working budget. Used to preview a saving
   before it's actually applied — the same simulate() the real plan uses,
   just run once more with a hypothetical bigger budget. */
export function previewMonthsSaved(state, extraAmount) {
  if (!state.debtModule || !(extraAmount > 0)) return 0;
  const current = payoffPlan(state);
  if (current.stalled) return 0;
  const preview = simulate(state.debts.filter((d) => !d.clearedAt), current.working + extraAmount, state.strategy);
  if (preview.stalled) return 0;
  return Math.max(0, current.months - preview.months);
}

/* Streaming-type bills (glyph 'music' or 'play') are the clearest
   "subscription overlap" signal: Spotify + Netflix + Disney+ all landing
   in the same household is exactly the case worth flagging. Only
   suggests something once two or more exist between your own bills and
   your share of the household's — cutting a single one wouldn't be
   "redundant", so there's nothing to suggest yet. sharedBills is passed
   in by the caller (already computed inside the privacy boundary from
   live household data) rather than read here, so this file still never
   imports anything shared itself. */
const SUBSCRIPTION_GLYPHS = ['music', 'play'];

export function subscriptionSuggestions(state, sharedBills) {
  const already = new Set(state.savings.map((s) => s.label.trim().toLowerCase()));
  const personalOnes = state.personal
    .filter((p) => SUBSCRIPTION_GLYPHS.includes(p.glyph))
    .map((p) => ({ source: 'personal', label: p.name, amount: num(p.amount), detail: 'Your own subscription' }));
  const sharedOnes = (sharedBills || [])
    .filter((b) => SUBSCRIPTION_GLYPHS.includes(b.glyph))
    .map((b) => ({ source: 'shared', label: b.name, amount: num(b.yourShare), detail: 'Your half of a shared bill' }));
  const all = [...personalOnes, ...sharedOnes];
  if (all.length < 2) return [];
  return all
    .filter((s) => !already.has(s.label.trim().toLowerCase()))
    .map((s) => ({ ...s, monthsSaved: previewMonthsSaved(state, s.amount) }))
    .filter((s) => s.monthsSaved > 0);
}

/* What the other person can see. Kept here, next to the private data,
   so the two lists can never drift apart. */
export const VISIBILITY = {
  shared: [
    'Your name and initials',
    'The household bills you both added, and who pays each provider',
    'Your share of each bill and whether you have paid it',
    'One-off money lent between the two of you',
    'The running balance and anything awaiting confirmation'
  ],
  never: [
    'Your take-home pay and payday',
    'Bills that are yours alone — phone, car insurance, gym, anything you add',
    'That you have any credit cards, loans or buy-now-pay-later at all',
    'Balances, APRs, minimum payments and promotional periods',
    'Your repayment strategy, budget and debt-free date',
    'Anything you model under “free up money”',
    'Whether the debt side is switched on or off',
    'Any bank export you look through — it never leaves your device'
  ]
};
