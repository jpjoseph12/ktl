import { describe, expect, it } from 'vitest';
import { daysUntil, guessRenewalKind, inRenewalWindow, renewalKind } from './renewals';
import { personalRenewalReminders, plannedReminders } from './reminders';

const NOW = new Date(2026, 9, 1); // 1 Oct 2026
const QUIET = { quietFrom: '22:00', quietTo: '08:00', weeklyDigest: false, paymentLead: 2, paymentTime: '18:00' };

describe('renewals — how far ahead to look', () => {
  it('warns energy six weeks out, broadband and mobile four, insurance three, anything else two', () => {
    expect(renewalKind('energy').lead).toBe(42);
    expect(renewalKind('broadband').lead).toBe(28);
    expect(renewalKind('mobile').lead).toBe(28);
    expect(renewalKind('insurance').lead).toBe(21);
    expect(renewalKind('other').lead).toBe(14);
    expect(renewalKind('nonsense').lead).toBe(14);
  });

  it('works out the kind from what the bill is called', () => {
    expect(guessRenewalKind('Octopus Energy')).toBe('energy');
    expect(guessRenewalKind('Gas & electric')).toBe('energy');
    expect(guessRenewalKind('Virgin Media broadband')).toBe('broadband');
    expect(guessRenewalKind('BT')).toBe('broadband');
    expect(guessRenewalKind('EE mobile')).toBe('mobile');
    expect(guessRenewalKind('Home insurance')).toBe('insurance');
    expect(guessRenewalKind('Netflix')).toBe('other');
    // Only whole words count: "gasket" isn’t gas.
    expect(guessRenewalKind('Gasket club')).toBe('other');
  });

  it('counts the days and knows when it’s time to look', () => {
    expect(daysUntil('2026-10-31', NOW)).toBe(30);
    expect(inRenewalWindow({ renewsOn: '2026-10-31', renewalKind: 'energy' }, NOW)).toBe(true);
    expect(inRenewalWindow({ renewsOn: '2026-10-31', renewalKind: 'insurance' }, NOW)).toBe(false);
    expect(inRenewalWindow({ renewsOn: '2026-09-20', renewalKind: 'other' }, NOW)).toBe(false);
    expect(inRenewalWindow({ renewsOn: null }, NOW)).toBe(false);
  });
});

describe('renewal reminders', () => {
  const energy = { id: 'e1', name: 'Energy', status: 'settled', dueSort: '2026-10-15', renewsOn: '2026-12-31', renewalKind: 'energy' };

  it('a shared bill’s renewal is in the household’s plan, at 9am six weeks before', () => {
    const plan = plannedReminders({ bills: [energy], reminders: QUIET, members: [], now: NOW });
    const r = plan.find((x) => x.kind === 'renewal');
    expect(r.title).toBe('Time to check Energy');
    expect(r.at).toEqual(new Date(2026, 10, 19, 9, 0));
    expect(r.body).toMatch(/49 days/);
  });

  it('an ended bill, or one without a date, has no renewal reminder', () => {
    const plan = plannedReminders({ bills: [{ ...energy, endedOn: '2026-09-01' }, { ...energy, id: 'e2', renewsOn: null }], reminders: QUIET, members: [], now: NOW });
    expect(plan.filter((x) => x.kind === 'renewal')).toHaveLength(0);
  });

  it('personal renewals are planned on their own, with ids that never clash with shared ones', () => {
    const [mine] = personalRenewalReminders({ bills: [{ id: 'e1', name: 'My phone', renewsOn: '2026-11-30', renewalKind: 'mobile' }], reminders: QUIET, now: NOW });
    const shared = plannedReminders({ bills: [energy], reminders: QUIET, members: [], now: NOW }).find((x) => x.kind === 'renewal');
    expect(mine.at).toEqual(new Date(2026, 10, 2, 9, 0));
    expect(mine.id).not.toBe(shared.id);
  });

  it('drops a reminder whose moment has already passed', () => {
    expect(personalRenewalReminders({ bills: [{ id: 'x', name: 'Car insurance', renewsOn: '2026-10-10', renewalKind: 'insurance' }], reminders: QUIET, now: NOW })).toHaveLength(0);
  });
});
