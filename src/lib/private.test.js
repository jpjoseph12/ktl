import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daysSincePayday, debtBudgetWarning, defaultState, emergencyFundOutgoings, emergencyFundPlan, monthlyInterestFor, monthsElapsed, payoffPlan, previewMonthsSaved, projectedDebt, rateInfo, simulate, standardAprFor, subscriptionSuggestions } from './private';

function stateWithDebt(overrides = {}) {
  const s = defaultState();
  return {
    ...s,
    debtModule: true,
    budget: 100,
    debts: [{ id: 'd1', name: 'Card', kind: 'Credit card', glyph: 'card', balance: 2000, apr: 20, min: 50, promo: 0 }],
    personal: [],
    savings: [],
    ...overrides
  };
}

describe('previewMonthsSaved', () => {
  it('returns 0 when the debt module is off', () => {
    const state = stateWithDebt({ debtModule: false });
    expect(previewMonthsSaved(state, 50)).toBe(0);
  });

  it('returns 0 for a non-positive extra amount', () => {
    const state = stateWithDebt();
    expect(previewMonthsSaved(state, 0)).toBe(0);
    expect(previewMonthsSaved(state, -10)).toBe(0);
  });

  it('returns a positive number of months when extra budget speeds up payoff', () => {
    const state = stateWithDebt();
    const saved = previewMonthsSaved(state, 100);
    expect(saved).toBeGreaterThan(0);
  });
});

describe('simulate — a cleared debt rolls its minimum into the next one (snowball/avalanche)', () => {
  it('speeds up the next debt once an earlier one clears, instead of leaving its minimum unused', () => {
    // Debt A (£100, min £50) clears in month 2. From then on its £50/mo
    // should roll into B rather than sitting idle — if it didn't, B would
    // only ever get its own £20/mo (budget covers exactly both minimums,
    // no extra), and a £1,000 balance at £20/mo takes 50 months.
    // Getting there meaningfully faster than that proves the rollover.
    const debts = [
      { id: 'a', balance: 100, apr: 0, min: 50, promo: 0 },
      { id: 'b', balance: 1000, apr: 0, min: 20, promo: 0 }
    ];
    const result = simulate(debts, 70, 'snowball');
    expect(result.payoff.a).toBe(2);
    expect(result.months).toBeLessThan(30);
    expect(result.stalled).toBe(false);
  });
});

describe('monthsElapsed', () => {
  it('is 0 for the exact same instant', () => {
    const now = new Date(2026, 5, 15);
    expect(monthsElapsed(now.toISOString(), now)).toBe(0);
  });

  it('does not count a month until the day-of-month has actually passed (floors down)', () => {
    const confirmedAt = new Date(2026, 0, 15).toISOString();
    const today = new Date(2026, 1, 10); // 5 days short of a full month
    expect(monthsElapsed(confirmedAt, today)).toBe(0);
  });

  it('counts a full month once the day-of-month has passed', () => {
    const confirmedAt = new Date(2026, 0, 15).toISOString();
    const today = new Date(2026, 1, 20);
    expect(monthsElapsed(confirmedAt, today)).toBe(1);
  });

  it('counts whole months correctly across a year boundary', () => {
    const confirmedAt = new Date(2025, 10, 20).toISOString(); // 20 Nov 2025
    const today = new Date(2026, 1, 25); // 25 Feb 2026
    expect(monthsElapsed(confirmedAt, today)).toBe(3);
  });

  it('never goes negative for a future or unparseable date', () => {
    expect(monthsElapsed(new Date(2030, 0, 1).toISOString(), new Date(2026, 0, 1))).toBe(0);
    expect(monthsElapsed(undefined, new Date())).toBe(0);
    expect(monthsElapsed('not a date', new Date())).toBe(0);
  });
});

describe('projectedDebt — rolling a balance forward from its last confirmation', () => {
  it('returns the stored balance unchanged at 0 months elapsed', () => {
    const today = new Date(2026, 5, 15);
    const debt = { balance: 1000, apr: 24, min: 50, promo: 0, confirmedAt: today.toISOString() };
    expect(projectedDebt(debt, today)).toEqual({ balance: 1000, promo: 0 });
  });

  it('matches a hand-computed month-by-month balance at a fixed APR and minimum', () => {
    const confirmedAt = new Date(2026, 0, 1);
    const today = new Date(2026, 3, 1); // 3 months later
    const debt = { balance: 1000, apr: 24, min: 50, promo: 0, confirmedAt: confirmedAt.toISOString() };
    // m1: 1000+20-50=970; m2: 970+19.4-50=939.4; m3: 939.4+18.788-50=908.188
    expect(projectedDebt(debt, today).balance).toBeCloseTo(908.19, 2);
  });

  it('counts promo down by real elapsed months and resumes interest once it runs out mid-projection', () => {
    const confirmedAt = new Date(2026, 0, 1);
    const today = new Date(2026, 4, 1); // 4 months later
    const debt = { balance: 1000, apr: 24, min: 50, promo: 2, confirmedAt: confirmedAt.toISOString() };
    // m1-2 promo (no interest): 1000-50=950, 950-50=900; m3: 900+18-50=868; m4: 868+17.36-50=835.36
    const result = projectedDebt(debt, today);
    expect(result.promo).toBe(0);
    expect(result.balance).toBeCloseTo(835.36, 2);
  });

  it('floors at 0 rather than going negative once minimum payments would have cleared it', () => {
    const confirmedAt = new Date(2026, 0, 1);
    const today = new Date(2026, 4, 1); // 5 months later
    const debt = { balance: 100, apr: 0, min: 50, promo: 0, confirmedAt: confirmedAt.toISOString() };
    expect(projectedDebt(debt, today).balance).toBe(0);
  });

  it('degrades safely with a zero minimum payment (interest still accrues, never divides by anything)', () => {
    const confirmedAt = new Date(2026, 0, 1);
    const today = new Date(2026, 2, 1); // 2 months later
    const debt = { balance: 500, apr: 10, min: 0, promo: 0, confirmedAt: confirmedAt.toISOString() };
    expect(projectedDebt(debt, today).balance).toBeGreaterThan(500);
  });
});

describe('payoffPlan — projected balances drive the whole plan, not the raw stored one', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows a lower balance today for a debt confirmed months ago than an identical one confirmed today', () => {
    vi.setSystemTime(new Date(2026, 3, 1));
    const staleState = stateWithDebt({
      budget: 200,
      debts: [{ id: 'stale', name: 'Stale', balance: 1000, apr: 24, min: 50, promo: 0, confirmedAt: new Date(2026, 0, 1).toISOString() }]
    });
    const freshState = stateWithDebt({
      budget: 200,
      debts: [{ id: 'fresh', name: 'Fresh', balance: 1000, apr: 24, min: 50, promo: 0, confirmedAt: new Date(2026, 3, 1).toISOString() }]
    });
    const staleRow = payoffPlan(staleState).rows.find((r) => r.id === 'stale');
    const freshRow = payoffPlan(freshState).rows.find((r) => r.id === 'fresh');
    expect(staleRow.balance).toBeLessThan(freshRow.balance);
  });

  it('flags needsCheckIn once 3 months have passed since confirmation, not before', () => {
    vi.setSystemTime(new Date(2026, 3, 1));
    const justUnder = stateWithDebt({
      debts: [{ id: 'd1', name: 'Card', balance: 1000, apr: 20, min: 50, promo: 0, confirmedAt: new Date(2026, 1, 10).toISOString() }]
    });
    const atThreshold = stateWithDebt({
      debts: [{ id: 'd1', name: 'Card', balance: 1000, apr: 20, min: 50, promo: 0, confirmedAt: new Date(2026, 0, 1).toISOString() }]
    });
    expect(payoffPlan(justUnder).rows[0].needsCheckIn).toBe(false);
    expect(payoffPlan(atThreshold).rows[0].needsCheckIn).toBe(true);
  });

  it('shows a debt the projection has cleared as its own row instead of silently dropping it', () => {
    vi.setSystemTime(new Date(2026, 5, 1));
    const state = stateWithDebt({
      budget: 300,
      debts: [
        { id: 'cleared', name: 'Small one', balance: 100, apr: 0, min: 50, promo: 0, confirmedAt: new Date(2026, 0, 1).toISOString() },
        { id: 'other', name: 'Big one', balance: 5000, apr: 20, min: 100, promo: 0, confirmedAt: new Date(2026, 5, 1).toISOString() }
      ]
    });
    const plan = payoffPlan(state);
    const clearedRow = plan.rows.find((r) => r.id === 'cleared');
    expect(clearedRow.projectedCleared).toBe(true);
    expect(clearedRow.balance).toBe(0);
    expect(clearedRow.rank).toBeNull();
    // the cleared debt's old minimum should no longer count against minTotal
    expect(plan.minTotal).toBe(100);
  });
});

describe('debtBudgetWarning — a non-blocking sanity check, never a hard ceiling', () => {
  it('returns null when there is a healthy amount left over', () => {
    const state = stateWithDebt({ income: 3000 });
    // household 0 + personal 0 (no householdShareAmount passed) -> plenty left after a 400 budget
    expect(debtBudgetWarning(state, 0, 400)).toBeNull();
  });

  it('warns, but does not throw or block, when the figure exceeds what is coming in', () => {
    const state = stateWithDebt({ income: 1000 });
    const warning = debtBudgetWarning(state, 500, 600); // 1000 - 500 household - 600 budget = -100
    expect(warning).toMatch(/more than you have coming in/i);
  });

  it('warns when it leaves only a thin margin, even though it is technically affordable', () => {
    const state = stateWithDebt({ income: 1000 });
    const warning = debtBudgetWarning(state, 0, 970); // 30 left over
    expect(warning).toMatch(/just £30\.00 spare/i);
  });

  it('applies the same absolute-pounds threshold regardless of income size (no unfair percentage)', () => {
    // A low income and a high income both get a warning at the same £ margin,
    // and both clear it at the same £ margin — the rule doesn't scale with
    // income, which is the whole point (a flat percentage was rejected
    // specifically because it disadvantages lower incomes).
    const low = stateWithDebt({ income: 500 });
    const high = stateWithDebt({ income: 5000 });
    expect(debtBudgetWarning(low, 0, 470)).toMatch(/just £30\.00 spare/i);
    expect(debtBudgetWarning(high, 0, 4970)).toMatch(/just £30\.00 spare/i);
    expect(debtBudgetWarning(low, 0, 400)).toBeNull();
    expect(debtBudgetWarning(high, 0, 4900)).toBeNull();
  });
});

describe('monthlyInterestFor', () => {
  it('computes the current month interest cost from balance and APR', () => {
    // £2,000 at 24.9% APR -> 2000 * (24.9 / 1200) = 41.5
    expect(monthlyInterestFor({ balance: 2000, apr: 24.9, promo: 0 })).toBeCloseTo(41.5, 2);
  });

  it('is 0 while a 0% promo period is still running', () => {
    expect(monthlyInterestFor({ balance: 2000, apr: 24.9, promo: 6 })).toBe(0);
  });

  it('is 0 for a 0% APR account', () => {
    expect(monthlyInterestFor({ balance: 500, apr: 0, promo: 0 })).toBe(0);
  });
});

describe('payoffPlan — per-debt monthly interest breakdown', () => {
  it('exposes each row’s current monthly interest cost', () => {
    const state = stateWithDebt({ budget: 200 });
    const plan = payoffPlan(state);
    const row = plan.rows.find((r) => r.id === 'd1');
    expect(row.monthlyInterest).toBeCloseTo(monthlyInterestFor(state.debts[0]), 2);
  });

  it('exposes the full rate/band/cost bundle on each row, matching rateInfo directly', () => {
    const state = stateWithDebt({ budget: 200 });
    const plan = payoffPlan(state);
    const row = plan.rows.find((r) => r.id === 'd1');
    expect(row.rate).toEqual(rateInfo(state.debts[0]));
  });
});

describe('rateInfo — one place deciding how a rate reads everywhere', () => {
  it('bands a low APR (<10%) as low', () => {
    expect(rateInfo({ balance: 1000, apr: 5, promo: 0 }).band).toBe('low');
  });

  it('bands a mid APR (10-20%) as mid', () => {
    expect(rateInfo({ balance: 1000, apr: 15, promo: 0 }).band).toBe('mid');
  });

  it('bands a high APR (20%+) as high', () => {
    expect(rateInfo({ balance: 1000, apr: 24.9, promo: 0 }).band).toBe('high');
  });

  it('bands a 0% APR account as zero, regardless of balance', () => {
    const info = rateInfo({ balance: 500, apr: 0, promo: 0 });
    expect(info.band).toBe('zero');
    expect(info.monthly).toBe(0);
    expect(info.cost).toBe('no interest');
  });

  it('bands an active promo period as promo even when a real APR is set to resume after it', () => {
    const info = rateInfo({ balance: 2000, apr: 24.9, promo: 6 });
    expect(info.band).toBe('promo');
    expect(info.monthly).toBe(0);
    expect(info.detail).toMatch(/24\.9% APR/);
  });

  it('formats the compact list cost as "+£X/mo" when interest is accruing', () => {
    const info = rateInfo({ balance: 2000, apr: 24.9, promo: 0 });
    expect(info.cost).toBe('+£41.50/mo');
  });
});

describe('payoffPlan — stalled budgets never report a runaway interest figure', () => {
  it('returns a sane, finite interest total when the budget clears the debt', () => {
    const state = stateWithDebt({ budget: 200 });
    const plan = payoffPlan(state);
    expect(plan.stalled).toBe(false);
    expect(plan.interest).toBeGreaterThan(0);
    expect(plan.interest).toBeLessThan(state.debts[0].balance);
  });

  it('reports interest as null (not a huge number) once the budget cannot cover the minimums', () => {
    // Regression test: a budget below the minimum payment leaves the
    // balance growing every month with nothing to check it, so the old
    // code ran the full 480-month simulation cap and reported whatever
    // absurd interest total that produced (tens of millions of pounds for
    // a real £2,000 card) instead of recognising the plan never resolves.
    const state = stateWithDebt({ budget: 10 }); // below the debt's own £50 minimum
    const plan = payoffPlan(state);
    expect(plan.stalled).toBe(true);
    expect(plan.interest).toBeNull();
  });
});

describe('subscriptionSuggestions', () => {
  it('suggests nothing with fewer than two streaming-type bills', () => {
    const state = stateWithDebt({
      personal: [{ id: 'p1', name: 'Netflix', glyph: 'play', amount: 12, day: 1 }]
    });
    expect(subscriptionSuggestions(state, [])).toEqual([]);
  });

  it('suggests both when two streaming bills exist across personal + shared', () => {
    const state = stateWithDebt({
      personal: [{ id: 'p1', name: 'Netflix', glyph: 'play', amount: 12, day: 1 }]
    });
    const shared = [{ name: 'Spotify Family', glyph: 'music', yourShare: 8 }];
    const suggestions = subscriptionSuggestions(state, shared);
    expect(suggestions.map((s) => s.label).sort()).toEqual(['Netflix', 'Spotify Family']);
    for (const s of suggestions) {
      expect(s.monthsSaved).toBeGreaterThan(0);
    }
  });

  it('does not re-suggest something already in the savings list', () => {
    const state = stateWithDebt({
      personal: [
        { id: 'p1', name: 'Netflix', glyph: 'play', amount: 12, day: 1 },
        { id: 'p2', name: 'Disney+', glyph: 'play', amount: 8, day: 1 }
      ],
      savings: [{ id: 's1', label: 'Netflix', detail: '', amount: 12, shared: false, applied: false }]
    });
    const suggestions = subscriptionSuggestions(state, []);
    expect(suggestions.map((s) => s.label)).toEqual(['Disney+']);
  });

  it('suggests nothing when the debt module is off, even with overlap', () => {
    const state = stateWithDebt({
      debtModule: false,
      personal: [
        { id: 'p1', name: 'Netflix', glyph: 'play', amount: 12, day: 1 },
        { id: 'p2', name: 'Disney+', glyph: 'play', amount: 8, day: 1 }
      ]
    });
    expect(subscriptionSuggestions(state, [])).toEqual([]);
  });
});

describe('emergencyFundOutgoings', () => {
  it('adds household share, personal bills and minimums when debt module is on', () => {
    const state = stateWithDebt({
      personal: [{ id: 'p1', name: 'Phone', glyph: 'phone', amount: 20, day: 1 }]
    });
    // household 500 + personal 20 + minimum 50 (from stateWithDebt's one debt)
    expect(emergencyFundOutgoings(state, 500)).toBe(570);
  });

  it('excludes minimums when the debt module is off', () => {
    const state = stateWithDebt({
      debtModule: false,
      personal: [{ id: 'p1', name: 'Phone', glyph: 'phone', amount: 20, day: 1 }]
    });
    expect(emergencyFundOutgoings(state, 500)).toBe(520);
  });
});

describe('emergencyFundPlan', () => {
  it('computes target as monthly outgoings times the chosen number of months', () => {
    const state = stateWithDebt({ personal: [], debts: [], emergencyMonths: 6 });
    const plan = emergencyFundPlan(state, 400);
    expect(plan.monthlyOutgoings).toBe(400);
    expect(plan.target).toBe(2400);
  });

  it('reports progress and remaining relative to what has been saved', () => {
    const state = stateWithDebt({ personal: [], debts: [], emergencyMonths: 3, emergencySaved: 300 });
    const plan = emergencyFundPlan(state, 400);
    expect(plan.target).toBe(1200);
    expect(plan.saved).toBe(300);
    expect(plan.remaining).toBe(900);
    expect(plan.progressPct).toBe(25);
  });

  it('never reports negative remaining once the target is exceeded', () => {
    const state = stateWithDebt({ personal: [], debts: [], emergencyMonths: 3, emergencySaved: 5000 });
    const plan = emergencyFundPlan(state, 400);
    expect(plan.remaining).toBe(0);
    expect(plan.progressPct).toBe(100);
  });
});

describe('daysSincePayday', () => {
  it('returns 0 on payday itself', () => {
    expect(daysSincePayday('15th', new Date(2026, 8, 15))).toBe(0);
  });

  it('returns days elapsed since payday earlier in the month', () => {
    expect(daysSincePayday('1st', new Date(2026, 8, 4))).toBe(3);
  });

  it('wraps to last month when payday has not happened yet this month', () => {
    // Sept has 30 days; payday the 28th, today the 2nd -> 4 days since (30-28+2)
    expect(daysSincePayday('28th', new Date(2026, 8, 2))).toBe(4);
  });

  it('clamps a payday beyond the days in the current month', () => {
    // Feb 2026 has 28 days; a "31st" payday effectively lands on the 28th
    expect(daysSincePayday('31st', new Date(2026, 1, 28))).toBe(0);
  });

  it('returns null when it cannot parse a day at all', () => {
    expect(daysSincePayday('', new Date())).toBeNull();
    expect(daysSincePayday('Last Friday', new Date())).toBeNull();
  });
});

describe('standardAprFor', () => {
  it('matches a known credit card by name, case-insensitively', () => {
    expect(standardAprFor('barclaycard platinum')).toMatchObject({ label: 'Barclaycard', apr: 28.9 });
    expect(standardAprFor('Halifax Clarity')).toMatchObject({ label: 'Halifax', apr: 24.9 });
  });

  it('flags interest-free BNPL providers at 0% with a caveat note', () => {
    const klarna = standardAprFor('Klarna Pay in 3');
    expect(klarna.apr).toBe(0);
    expect(klarna.note).toMatch(/interest-free/i);
  });

  it('matches Currys YourPlan by either the retailer or the brand name', () => {
    expect(standardAprFor('Currys credit')).toMatchObject({ label: 'Currys YourPlan', apr: 29.9 });
    expect(standardAprFor('YourPlan')).toMatchObject({ label: 'Currys YourPlan', apr: 29.9 });
  });

  it('matches a Next credit account without false-matching the common word "next"', () => {
    expect(standardAprFor('NextPay')).toMatchObject({ label: 'Next (nextpay)', apr: 24.9 });
    expect(standardAprFor('Next account')).toMatchObject({ label: 'Next (nextpay)', apr: 24.9 });
    expect(standardAprFor('My next holiday fund')).toBeNull();
  });

  it('returns null for a name that matches nothing in the reference table', () => {
    expect(standardAprFor('My mystery loan')).toBeNull();
  });

  it('returns null for an empty or missing name', () => {
    expect(standardAprFor('')).toBeNull();
    expect(standardAprFor(undefined)).toBeNull();
  });

  it('does not cross-match unrelated providers with similar substrings', () => {
    // "Very" is a real (higher-APR) catalogue lender — make sure a name
    // that merely contains "very" as a substring doesn't false-match it.
    expect(standardAprFor('Everyday Loans')).toBeNull();
  });
});

describe('payoffPlan — a cleared debt is finished business', () => {
  it('drops it out of the plan so it cannot drag the payoff date around', () => {
    const state = stateWithDebt({
      budget: 200,
      debts: [
        { id: 'live', name: 'Live', balance: 1000, apr: 20, min: 50, promo: 0, confirmedAt: new Date().toISOString() },
        { id: 'done', name: 'Done', balance: 5000, apr: 30, min: 200, promo: 0, confirmedAt: new Date().toISOString(), clearedAt: new Date().toISOString() }
      ]
    });
    const plan = payoffPlan(state);
    expect(plan.rows.map((r) => r.id)).toEqual(['live']);
    // the cleared debt's £200 minimum must not still be demanded
    expect(plan.minTotal).toBe(50);
    expect(plan.totalOwed).toBe(1000);
  });

  it('stops counting a cleared debt toward what you would need if income stopped', () => {
    const base = stateWithDebt({
      debts: [{ id: 'd1', name: 'Card', balance: 2000, apr: 20, min: 50, promo: 0 }]
    });
    const cleared = stateWithDebt({
      debts: [{ id: 'd1', name: 'Card', balance: 0, apr: 20, min: 50, promo: 0, clearedAt: new Date().toISOString() }]
    });
    expect(emergencyFundOutgoings(base, 500)).toBe(550);
    expect(emergencyFundOutgoings(cleared, 500)).toBe(500);
  });
});
