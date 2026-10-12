import { describe, expect, it } from 'vitest';
import { analyseSpending, merchantKey, parseCsv, parseDate, readTransactions } from './spending';

const HEADER = 'Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In';

function monzo(rows) {
  return [HEADER, ...rows.map(([date, type, name, category, amount], i) =>
    `tx_${i},${date},09:00:00,${type},"${name}",,${category},${amount},GBP,${amount},GBP,,,,"${name}",,${amount < 0 ? -amount : ''},${amount > 0 ? amount : ''}`
  )].join('\n');
}

describe('parseCsv', () => {
  it('handles quotes, commas and newlines inside fields, and a BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"Smith, J","line one\nline two"\r\n"say ""hi""",2\n');
    expect(rows).toEqual([['a', 'b'], ['Smith, J', 'line one\nline two'], ['say "hi"', '2']]);
  });
});

describe('parseDate', () => {
  it('reads UK and ISO dates', () => {
    expect(parseDate('03/09/2026').toISOString().slice(0, 10)).toBe('2026-09-03');
    expect(parseDate('2026-09-03').toISOString().slice(0, 10)).toBe('2026-09-03');
    expect(parseDate('03/09/26').toISOString().slice(0, 10)).toBe('2026-09-03');
  });
});

describe('readTransactions', () => {
  it('reads a Monzo export and leaves pot transfers out of spending', () => {
    const txns = readTransactions(monzo([
      ['01/09/2026', 'Card payment', 'Tesco', 'Groceries', -42.1],
      ['02/09/2026', 'Pot transfer', 'Holiday pot', 'Savings', -100],
      ['03/09/2026', 'Bacs (Direct Credit)', 'Employer', 'Income', 2100]
    ]));
    expect(txns).toHaveLength(3);
    expect(txns.filter((t) => t.spending).map((t) => t.name)).toEqual(['Tesco']);
  });

  it('works with Money Out / Money In columns too', () => {
    const txns = readTransactions('Date,Description,Money Out,Money In\n2026-09-01,Cafe,3.20,\n2026-09-02,Salary,,2000\n');
    expect(txns.map((t) => t.amount)).toEqual([-3.2, 2000]);
  });

  it('explains what it wants when the file isn’t an export', () => {
    expect(() => readTransactions('foo,bar\n1,2\n')).toThrow(/Export transactions/);
  });
});

describe('merchantKey', () => {
  it('treats card-terminal noise as the same merchant', () => {
    expect(merchantKey('AMAZON* 1A2B3C')).toBe(merchantKey('Amazon'));
    expect(merchantKey('Pret A Manger Ltd')).toBe('pret a manger');
  });
});

describe('analyseSpending', () => {
  const rows = [];
  // Three months of: two streaming services, a price rise, a coffee habit,
  // groceries, and a double charge.
  ['07', '08', '09'].forEach((m, i) => {
    rows.push([`05/${m}/2026`, 'Card payment', 'Netflix', 'Entertainment', -10.99]);
    rows.push([`12/${m}/2026`, 'Card payment', 'Spotify', 'Entertainment', i < 2 ? -11.99 : -12.99]);
    rows.push([`02/${m}/2026`, 'Card payment', 'Tesco', 'Groceries', -180]);
    for (let d = 1; d <= 24; d += 3) rows.push([`${String(d).padStart(2, '0')}/${m}/2026`, 'Card payment', 'Pret A Manger', 'Eating out', -4.5]);
  });
  rows.push(['20/09/2026', 'Card payment', 'Argos', 'Shopping', -25]);
  rows.push(['20/09/2026', 'Card payment', 'Argos', 'Shopping', -25]);
  const txns = readTransactions(monzo(rows));

  it('totals spending per month and by category', () => {
    const a = analyseSpending(txns);
    expect(a.categories[0].category).toBe('Groceries');
    expect(a.spent).toBeGreaterThan(0);
    expect(a.spentMonthly).toBeLessThan(a.spent);
  });

  it('spots regular payments, and leaves ones KTL already tracks alone', () => {
    const a = analyseSpending(txns, { tracked: ['Netflix'] });
    const names = a.recurring.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['Netflix', 'Spotify']));
    // the weekly shop is steady too, but it's not a subscription
    expect(names).not.toContain('Tesco');
    expect(a.findings.some((f) => f.id === 'untracked:netflix')).toBe(false);
    expect(a.findings.some((f) => f.id === 'untracked:spotify')).toBe(true);
  });

  it('flags overlapping streaming, a price rise, a habit and a double charge', () => {
    const kinds = analyseSpending(txns).findings.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['overlap', 'rise', 'often', 'double']));
    expect(kinds[0]).toBe('double');
  });
});
