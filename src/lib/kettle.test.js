import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMON_SUBSCRIPTIONS, computeBalances, equalShares, frequencyLabel, glyphFor, logoFor, monthlyEquivalent, nextDateForDay, nextDueDate, remainingShare, round2, sharesFromPercents } from './kettle';

describe('glyphFor', () => {
  it('categorises obvious cases correctly', () => {
    expect(glyphFor('EE mobile')).toBe('phone');
    expect(glyphFor('Admiral car insurance')).toBe('shield');
    expect(glyphFor('PureGym Camden')).toBe('gym');
    expect(glyphFor('Spotify Family')).toBe('music');
    expect(glyphFor('Netflix')).toBe('play');
  });

  it('does not mistake "Youtube TV" for a train/tube bill', () => {
    // "Youtube" contains "tube" as a bare substring — a naive train-pattern
    // match would misfire here and never reach the (correct) 'play' check.
    expect(glyphFor('Youtube TV')).toBe('play');
  });

  it('does not mistake a card provider name for a car/vehicle bill', () => {
    // "Barclaycard" and "Mastercard" both contain "car" as a substring.
    expect(glyphFor('Barclaycard')).toBe('card');
    expect(glyphFor('Mastercard')).toBe('card');
  });

  it('still recognises a real car-related bill', () => {
    expect(glyphFor('Car insurance')).toBe('shield'); // insur checked first
    expect(glyphFor('Car parking permit')).toBe('car');
  });

  it('still recognises a real tube/train bill', () => {
    expect(glyphFor('London tube pass')).toBe('train');
    expect(glyphFor('Southern rail season ticket')).toBe('train');
  });
});

describe('logoFor', () => {
  it('matches a known provider case-insensitively and returns its real intrinsic dimensions', () => {
    expect(logoFor('netflix')).toMatchObject({ logo: 'netflix.svg', provider: 'Netflix', logoW: 1000, logoH: 464 });
    expect(logoFor('Spotify Duo')).toMatchObject({ logo: 'spotify.svg', provider: 'Spotify' });
    expect(logoFor('Virgin Media Broadband')).toMatchObject({ logo: 'virgin-media.svg', provider: 'Virgin Media' });
  });

  it('does not match an unrelated provider with a similar substring', () => {
    // "Virgin Active" (gym) and "Virgin Money" should never pick up the
    // Virgin Media broadband logo just because they share "Virgin".
    expect(logoFor('Virgin Active')).toBeNull();
    expect(logoFor('Virgin Money')).toBeNull();
  });

  it('returns null for a name with no matching brand asset', () => {
    expect(logoFor('Council Tax')).toBeNull();
    expect(logoFor('')).toBeNull();
    expect(logoFor(undefined)).toBeNull();
  });
});

describe('COMMON_SUBSCRIPTIONS autocomplete list', () => {
  it('has every entry resolve to a real category, not the generic fallback', () => {
    // If this ever fails, either the new name needs a matching keyword in
    // glyphFor(), or glyphFor() needs a pattern added for it — the list is
    // pointless if picking a suggestion just gives you the default icon.
    const uncategorised = COMMON_SUBSCRIPTIONS.filter((name) => glyphFor(name) === 'card');
    expect(uncategorised).toEqual([]);
  });

  it('has no duplicate entries', () => {
    expect(new Set(COMMON_SUBSCRIPTIONS).size).toBe(COMMON_SUBSCRIPTIONS.length);
  });
});

describe('nextDateForDay', () => {
  const ORIGINAL_TZ = process.env.TZ;

  beforeEach(() => {
    // Regression coverage for a real bug: nextDateForDay used to build the
    // result with `.toISOString()`, which converts to UTC first — in any
    // timezone ahead of UTC (BST included) that silently shifted every due
    // date back a day, and a day-1 bill would land in the *previous* month
    // entirely. Force a timezone ahead of UTC so the bug would reproduce
    // here regardless of the machine/CI running these tests.
    process.env.TZ = 'Europe/London';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = ORIGINAL_TZ;
  });

  it('rolls a day that has already passed this month into next month, on the correct date', () => {
    vi.setSystemTime(new Date(2026, 8, 13)); // 13 Sept 2026, BST (UTC+1)
    expect(nextDateForDay(1)).toBe('2026-10-01');
  });

  it('keeps a day that has not passed yet in the current month', () => {
    vi.setSystemTime(new Date(2026, 8, 13));
    expect(nextDateForDay(15)).toBe('2026-09-15');
  });

  it('clamps an end-of-month day to the real last day of a short month', () => {
    vi.setSystemTime(new Date(2026, 8, 13)); // September has 30 days
    expect(nextDateForDay(31)).toBe('2026-09-30');
  });

  it('clamps to the real last day of February in a non-leap year', () => {
    vi.setSystemTime(new Date(2027, 1, 1)); // 1 Feb 2027 — GMT, not BST
    expect(nextDateForDay(31)).toBe('2027-02-28');
  });
});

describe('equalShares', () => {
  it('splits evenly when the total divides cleanly', () => {
    expect(equalShares(100, ['a', 'b'])).toEqual({ a: 50, b: 50 });
  });

  it('a 3-way split of £100 sums to exactly £100 despite repeating decimals', () => {
    const shares = equalShares(100, ['a', 'b', 'c']);
    const total = Object.values(shares).reduce((s, v) => s + v, 0);
    expect(Math.round(total * 100) / 100).toBe(100);
    // no member is shorted by more than a penny of rounding
    Object.values(shares).forEach((v) => expect(Math.abs(v - 33.33)).toBeLessThan(0.02));
  });

  it('a 6-way split sums exactly to the total', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const shares = equalShares(70, ids);
    const total = Object.values(shares).reduce((s, v) => s + v, 0);
    expect(Math.round(total * 100) / 100).toBe(70);
  });

  it('returns an empty map for no members', () => {
    expect(equalShares(100, [])).toEqual({});
  });
});

describe('sharesFromPercents', () => {
  it('a custom 6-way percent split still sums to exactly the total after rounding', () => {
    const shares = sharesFromPercents(99.97, { a: 17, b: 17, c: 17, d: 17, e: 16, f: 16 });
    const total = Object.values(shares).reduce((s, v) => s + v, 0);
    expect(Math.round(total * 100) / 100).toBe(99.97);
  });

  it('a simple 70/30 split matches exactly', () => {
    expect(sharesFromPercents(100, { a: 70, b: 30 })).toEqual({ a: 70, b: 30 });
  });
});

describe('computeBalances — never silently drops a share in a 3+ person household', () => {
  it('attributes a 4-way bill correctly when a 3rd member is the payer', () => {
    const items = [{ payerId: 'C', status: 'payment-due', shares: { A: 25, B: 25, C: 25, D: 25 } }];
    const result = computeBalances(items, 'A'); // 'A' is "you"
    expect(result.C.youOwe).toBe(25); // you owe the payer your own share
    expect(result.B).toBeUndefined(); // B's debt is to C, not to you
    expect(result.D).toBeUndefined(); // same — not your pairwise balance
  });

  it('sums everything owed to you across 5 other members when you are the payer', () => {
    const items = [{ payerId: 'A', status: 'payment-due', shares: { A: 20, B: 16, C: 16, D: 16, E: 16, F: 16 } }];
    const result = computeBalances(items, 'A');
    expect(result.B.theyOwe).toBe(16);
    expect(result.F.theyOwe).toBe(16);
    const totalOwedToYou = Object.values(result).reduce((s, b) => s + b.theyOwe, 0);
    expect(totalOwedToYou).toBeCloseTo(80, 2);
  });

  it('keeps balances with different people separate across multiple bills', () => {
    const items = [
      { payerId: 'you', status: 'payment-due', shares: { you: 50, b: 50 } },
      { payerId: 'c', status: 'payment-due', shares: { you: 20, c: 20 } }
    ];
    const result = computeBalances(items, 'you');
    expect(result.b.theyOwe).toBe(50);
    expect(result.c.youOwe).toBe(20);
    expect(result.b.youOwe).toBe(0);
    expect(result.c.theyOwe).toBe(0);
  });

  it('routes settled and in-flight amounts to the right bucket, not into the open total', () => {
    const items = [
      { payerId: 'you', status: 'settled', shares: { you: 10, b: 10 } },
      { payerId: 'you', status: 'sent', shares: { you: 10, b: 10 } },
      { payerId: 'you', status: 'payment-due', shares: { you: 10, b: 10 } }
    ];
    const result = computeBalances(items, 'you');
    expect(result.b.settled).toBe(10);
    expect(result.b.inFlightToYou).toBe(10);
    expect(result.b.theyOwe).toBe(10);
  });
});

describe('monthlyEquivalent — one comparable figure whatever the rhythm', () => {
  it('leaves a monthly bill alone', () => {
    expect(monthlyEquivalent(50, 'month', 1)).toBe(50);
  });

  it('spreads an annual bill across the year', () => {
    // £240 car insurance once a year is £20 a month of real money.
    expect(monthlyEquivalent(240, 'year', 1)).toBe(20);
  });

  it('divides a quarterly bill over its three months', () => {
    expect(monthlyEquivalent(90, 'month', 3)).toBe(30);
  });

  it('converts weekly using 52 weeks, not 4 per month', () => {
    // £10 a week is £43.33 a month — the naive x4 would understate it.
    expect(monthlyEquivalent(10, 'week', 1)).toBeCloseTo(43.33, 2);
  });

  it('handles four-weekly, which is not the same as monthly', () => {
    expect(monthlyEquivalent(40, 'week', 4)).toBeCloseTo(43.33, 2);
  });
});

describe('frequencyLabel', () => {
  it('names the common rhythms', () => {
    expect(frequencyLabel('month', 1, 15)).toBe('Monthly, on the 15th');
    expect(frequencyLabel('month', 3, 1)).toBe('Quarterly, on the 1st');
    expect(frequencyLabel('year', 1, 3)).toBe('Yearly, on the 3rd');
  });

  it('does not claim a day-of-month for weekly bills, which have none', () => {
    expect(frequencyLabel('week', 1, 15)).toBe('Weekly');
    expect(frequencyLabel('week', 4, 15)).toBe('Four-weekly');
  });
});

describe('nextDueDate', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'Europe/London'; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); process.env.TZ = ORIGINAL_TZ; });

  it('steps a weekly bill forward from today', () => {
    vi.setSystemTime(new Date(2026, 8, 13));
    expect(nextDueDate('week', 1, null)).toBe('2026-09-20');
  });

  it('steps a four-weekly bill 28 days, not a month', () => {
    vi.setSystemTime(new Date(2026, 8, 13));
    expect(nextDueDate('week', 4, null)).toBe('2026-10-11');
  });

  it('keeps monthly behaviour identical to before', () => {
    vi.setSystemTime(new Date(2026, 8, 13));
    expect(nextDueDate('month', 1, 15)).toBe('2026-09-15');
    expect(nextDueDate('month', 1, 1)).toBe('2026-10-01');
  });

  it('pushes a quarterly bill two further months out', () => {
    vi.setSystemTime(new Date(2026, 8, 13));
    // next 15th is 15 Sep; quarterly means the one after that is 15 Dec
    expect(nextDueDate('month', 3, 15)).toBe('2026-11-15');
  });

  it('clamps to a real day when the target month is short', () => {
    vi.setSystemTime(new Date(2026, 0, 15));
    expect(nextDueDate('month', 2, 31)).toBe('2026-02-28');
  });
});

describe('computeBalances — part-payments stop being chased', () => {
  it('only counts what is still owed, not the original share', () => {
    const items = [{
      payerId: 'you', status: 'payment-due',
      shares: { you: 50, b: 50 }, paid: { b: 20 }
    }];
    const result = computeBalances(items, 'you');
    expect(result.b.theyOwe).toBe(30);
  });

  it('drops to zero owed once the share is fully paid, even before the item closes', () => {
    const items = [{
      payerId: 'you', status: 'payment-due',
      shares: { you: 50, b: 50 }, paid: { b: 50 }
    }];
    expect(computeBalances(items, 'you').b.theyOwe).toBe(0);
  });

  it('nets a part-payment off what YOU owe too, not just what you are owed', () => {
    const items = [{
      payerId: 'sam', status: 'payment-due',
      shares: { you: 60, sam: 40 }, paid: { you: 25 }
    }];
    expect(computeBalances(items, 'you').sam.youOwe).toBe(35);
  });

  it('never goes negative if more was paid than the share', () => {
    const items = [{
      payerId: 'you', status: 'payment-due',
      shares: { you: 50, b: 50 }, paid: { b: 80 }
    }];
    expect(computeBalances(items, 'you').b.theyOwe).toBe(0);
  });

  it('keeps the full share in the settled bucket, since that records what it was', () => {
    const items = [{
      payerId: 'you', status: 'settled',
      shares: { you: 50, b: 50 }, paid: { b: 50 }
    }];
    const result = computeBalances(items, 'you');
    expect(result.b.settled).toBe(50);
    expect(result.b.theyOwe).toBe(0);
  });

  it('behaves exactly as before for items with no part-payments recorded', () => {
    const withoutPaid = [{ payerId: 'you', status: 'payment-due', shares: { you: 50, b: 50 } }];
    const withZeroPaid = [{ payerId: 'you', status: 'payment-due', shares: { you: 50, b: 50 }, paid: { b: 0 } }];
    expect(computeBalances(withoutPaid, 'you').b.theyOwe).toBe(50);
    expect(computeBalances(withZeroPaid, 'you').b.theyOwe).toBe(50);
  });
});

describe('refunds and credits — a negative amount must survive the whole pipeline', () => {
  it('splits a refund the same way a charge is split', () => {
    // £90 energy refund across three people = £30 back each.
    const shares = equalShares(-90, ['a', 'b', 'c']);
    expect(shares).toEqual({ a: -30, b: -30, c: -30 });
  });

  it('keeps a refund summing to exactly the total when it does not divide evenly', () => {
    const shares = equalShares(-100, ['a', 'b', 'c']);
    const total = Object.values(shares).reduce((s, v) => s + v, 0);
    expect(round2(total)).toBe(-100);
  });

  it('splits a refund by custom percentages too', () => {
    expect(sharesFromPercents(-100, { a: 70, b: 30 })).toEqual({ a: -70, b: -30 });
  });

  it('does not let remainingShare erase a credit', () => {
    // The bug this guards: a blunt Math.max(0, …) clamp swallowed the
    // whole refund and it silently became zero.
    expect(remainingShare(-30, 0)).toBe(-30);
    expect(remainingShare(30, 0)).toBe(30);
  });

  it('clamps toward zero in each direction, so nobody overpays past square', () => {
    expect(remainingShare(30, 50)).toBe(0);
    expect(remainingShare(-30, -50)).toBe(0);
  });

  it('turns a refund into money owed BACK to the household', () => {
    // You received a £60 refund on a bill you paid; Sam is due £30 of it.
    const items = [{ payerId: 'you', status: 'payment-due', shares: { you: -30, sam: -30 } }];
    const result = computeBalances(items, 'you');
    // Negative "theyOwe" = you owe them — the direction the net reads from.
    expect(result.sam.theyOwe).toBe(-30);
    expect(result.sam.net).toBe(30);
  });

  it('nets a refund off against an ordinary charge with the same person', () => {
    const items = [
      { payerId: 'you', status: 'payment-due', shares: { you: 50, sam: 50 } },
      { payerId: 'you', status: 'payment-due', shares: { you: -20, sam: -20 } }
    ];
    // Sam owed 50, then got 20 credited back — 30 left.
    expect(computeBalances(items, 'you').sam.theyOwe).toBe(30);
  });
});
