import { describe, expect, it } from 'vitest';
import { applyQuietHours, plannedReminders, quietHoursOn, reminderId } from './reminders';

// The bill reminders on their own: no nudge, no Sunday summary (tested below).
const REMINDERS = {
  detailsLead: 5, detailsTime: '09:00',
  paymentLead: 2, paymentTime: '18:00',
  quietFrom: '22:00', quietTo: '08:00',
  nudgeAfter: 0, weeklyDigest: false
};

const MEMBERS = [
  { id: 'me', name: 'Alex' },
  { id: 'sam', name: 'Sam' }
];

function bill(overrides = {}) {
  return {
    id: 'b1', name: 'Council Tax', status: 'scheduled',
    dueSort: '2026-10-15', payer: 'partner', payerId: 'sam',
    needsDetails: false, details: {},
    ...overrides
  };
}

const NOW = new Date(2026, 9, 1); // 1 Oct 2026

describe('plannedReminders — payment reminders', () => {
  it('fires paymentLead days before the due date, at paymentTime', () => {
    const [r] = plannedReminders({ bills: [bill()], reminders: REMINDERS, members: MEMBERS, now: NOW });
    expect(r.at.getFullYear()).toBe(2026);
    expect(r.at.getMonth()).toBe(9); // October
    expect(r.at.getDate()).toBe(13); // 15th minus 2 days
    expect(r.at.getHours()).toBe(18);
    expect(r.at.getMinutes()).toBe(0);
  });

  it('names the payer when you owe them', () => {
    const [r] = plannedReminders({ bills: [bill()], reminders: REMINDERS, members: MEMBERS, now: NOW });
    expect(r.title).toMatch(/send your share to sam/i);
  });

  it('flips the wording when you are the one owed', () => {
    const [r] = plannedReminders({
      bills: [bill({ payer: 'you', payerId: 'me' })], reminders: REMINDERS, members: MEMBERS, now: NOW
    });
    expect(r.title).toMatch(/others send you their share/i);
  });

  it('skips bills that are already closed', () => {
    const out = plannedReminders({
      bills: [bill({ status: 'settled' }), bill({ id: 'b2', status: 'sent' })],
      reminders: REMINDERS, members: MEMBERS, now: NOW
    });
    expect(out).toHaveLength(0);
  });

  it('never schedules something already in the past', () => {
    const out = plannedReminders({
      bills: [bill({ dueSort: '2026-09-02' })], reminders: REMINDERS, members: MEMBERS, now: NOW
    });
    expect(out).toHaveLength(0);
  });

  it('returns soonest first', () => {
    const out = plannedReminders({
      bills: [bill({ id: 'late', dueSort: '2026-11-20' }), bill({ id: 'soon', dueSort: '2026-10-10' })],
      reminders: REMINDERS, members: MEMBERS, now: NOW
    });
    expect(out.map((r) => r.billId)).toEqual(['soon', 'late']);
  });
});

describe('plannedReminders — details reminders', () => {
  it('adds one when details are outstanding', () => {
    const out = plannedReminders({
      bills: [bill({ needsDetails: true, detailsLabel: 'Meter reading' })],
      reminders: REMINDERS, members: MEMBERS, now: NOW
    });
    const details = out.find((r) => r.kind === 'details');
    expect(details.title).toMatch(/add your meter reading/i);
    expect(details.at.getDate()).toBe(10); // 15th minus 5 days
    expect(details.at.getHours()).toBe(9);
  });

  it('drops it once every member has added theirs', () => {
    const out = plannedReminders({
      bills: [bill({ needsDetails: true, details: { me: { done: true }, sam: { done: true } } })],
      reminders: REMINDERS, members: MEMBERS, now: NOW
    });
    expect(out.filter((r) => r.kind === 'details')).toHaveLength(0);
  });

  it('keeps it while only some members have added theirs', () => {
    const out = plannedReminders({
      bills: [bill({ needsDetails: true, details: { me: { done: true } } })],
      reminders: REMINDERS, members: MEMBERS, now: NOW
    });
    expect(out.filter((r) => r.kind === 'details')).toHaveLength(1);
  });
});

describe('plannedReminders — ended bills', () => {
  it('stops asking for a meter reading once the bill has ended', () => {
    const out = plannedReminders({
      bills: [bill({ needsDetails: true, detailsLabel: 'Meter reading', endedOn: '2026-09-30' })],
      reminders: REMINDERS, members: MEMBERS, now: NOW
    });
    expect(out.filter((r) => r.kind === 'details')).toHaveLength(0);
  });

  it('still chases the payment, because ending a bill does not unspend what is owed', () => {
    const out = plannedReminders({
      bills: [bill({ endedOn: '2026-09-30' })],
      reminders: REMINDERS, members: MEMBERS, now: NOW
    });
    expect(out.filter((r) => r.kind === 'payment')).toHaveLength(1);
  });
});

describe('applyQuietHours', () => {
  it('leaves a daytime reminder alone', () => {
    const at = new Date(2026, 9, 13, 18, 0);
    expect(applyQuietHours(at, '22:00', '08:00')).toEqual(at);
  });

  it('pushes a late-night reminder to the next morning', () => {
    const at = new Date(2026, 9, 13, 23, 30);
    const out = applyQuietHours(at, '22:00', '08:00');
    expect(out.getDate()).toBe(14);
    expect(out.getHours()).toBe(8);
    expect(out.getMinutes()).toBe(0);
  });

  it('pushes an early-morning reminder forward to the same day', () => {
    const at = new Date(2026, 9, 13, 6, 15);
    const out = applyQuietHours(at, '22:00', '08:00');
    expect(out.getDate()).toBe(13);
    expect(out.getHours()).toBe(8);
  });

  it('does nothing when quiet hours are disabled by an empty window', () => {
    const at = new Date(2026, 9, 13, 23, 30);
    expect(applyQuietHours(at, '08:00', '08:00')).toEqual(at);
  });

  it('shifts a scheduled reminder out of the quiet window end to end', () => {
    const out = plannedReminders({
      bills: [bill()],
      reminders: { ...REMINDERS, paymentTime: '23:00' },
      members: MEMBERS, now: NOW
    });
    // 23:00 is inside 22:00–08:00, so it lands at 08:00 the following day.
    expect(out[0].at.getDate()).toBe(14);
    expect(out[0].at.getHours()).toBe(8);
  });
});

describe('reminderId', () => {
  it('is stable for the same bill and kind, so rescheduling replaces rather than duplicates', () => {
    expect(reminderId('b1:payment')).toBe(reminderId('b1:payment'));
  });

  it('differs per kind and per bill', () => {
    expect(reminderId('b1:payment')).not.toBe(reminderId('b1:details'));
    expect(reminderId('b1:payment')).not.toBe(reminderId('b2:payment'));
  });

  it('always produces a positive 32-bit-safe integer for Android', () => {
    ['b1:payment', 'zzz:details', 'x'.repeat(80)].forEach((k) => {
      const id = reminderId(k);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(2147483647);
    });
  });
});

describe('plannedReminders — the settings in House → Reminders', () => {
  it('follows up after the money reminder, while the bill is open', () => {
    const out = plannedReminders({ bills: [bill()], reminders: { ...REMINDERS, nudgeAfter: 24 }, members: MEMBERS, now: NOW });
    const nudge = out.find((r) => r.kind === 'nudge');
    expect(nudge.title).toMatch(/still to confirm: council tax/i);
    expect(nudge.body).toMatch(/mark it as sent so they can confirm/i);
    // Money reminder 13 Oct 18:00, +24 hours = 14 Oct 18:00.
    expect(nudge.at.getDate()).toBe(14);
    expect(nudge.at.getHours()).toBe(18);
  });

  it('asks the payer to confirm, rather than to send', () => {
    const out = plannedReminders({ bills: [bill({ payer: 'you', payerId: 'me' })], reminders: { ...REMINDERS, nudgeAfter: 24 }, members: MEMBERS, now: NOW });
    expect(out.find((r) => r.kind === 'nudge').title).toMatch(/has everyone paid/i);
  });

  it('never nudges in tracking only, or with nudges off', () => {
    const tracking = plannedReminders({ bills: [bill()], reminders: { ...REMINDERS, nudgeAfter: 24 }, members: MEMBERS, mode: 'track', now: NOW });
    expect(tracking.some((r) => r.kind === 'nudge')).toBe(false);
    const off = plannedReminders({ bills: [bill()], reminders: REMINDERS, members: MEMBERS, now: NOW });
    expect(off.some((r) => r.kind === 'nudge')).toBe(false);
  });

  it('sums up the week ahead on Sunday evening', () => {
    const out = plannedReminders({
      bills: [bill({ dueSort: '2026-10-06' }), bill({ id: 'b2', name: 'Broadband', dueSort: '2026-10-20' })],
      reminders: { ...REMINDERS, weeklyDigest: true }, members: MEMBERS, now: NOW
    });
    const digest = out.find((r) => r.kind === 'digest');
    expect(digest.at.getDay()).toBe(0); // Sunday
    expect(digest.at.getDate()).toBe(4); // 1 Oct 2026 is a Thursday
    expect(digest.at.getHours()).toBe(18);
    expect(digest.body).toBe('Due this week: Council Tax (6th).');
  });

  it('says so when nothing is due, and stays quiet when turned off', () => {
    const on = plannedReminders({ bills: [], reminders: { ...REMINDERS, weeklyDigest: true }, members: MEMBERS, now: NOW });
    expect(on[0].body).toBe('Nothing due this week.');
    expect(plannedReminders({ bills: [], reminders: REMINDERS, members: MEMBERS, now: NOW })).toEqual([]);
  });

  it('treats the same start and end as quiet hours off', () => {
    expect(quietHoursOn({ quietFrom: '22:00', quietTo: '08:00' })).toBe(true);
    expect(quietHoursOn({ quietFrom: '00:00', quietTo: '00:00' })).toBe(false);
    const late = plannedReminders({ bills: [bill()], reminders: { ...REMINDERS, paymentTime: '23:30', quietFrom: '00:00', quietTo: '00:00' }, members: MEMBERS, now: NOW });
    expect(late[0].at.getHours()).toBe(23);
  });
});
