/* KTL — what the app should remind you about, and exactly when.
 *
 * Pure and side-effect free on purpose: the Alerts screen renders this
 * list, and the notification scheduler hands the same list to the OS, so
 * the schedule someone reads in the app is by construction the schedule
 * they actually get pinged on. Nothing here touches Capacitor — see
 * lib/notifications.js for the bridge.
 *
 * Every entry is derived from a real open bill's due date. There is no
 * fabricated or example schedule in here.
 */
import { OPEN, ordinalSuffix } from './kettle';
import { renewalReminders } from './renewals';

/* Android's LocalNotifications wants a stable 32-bit int id, but our
   records are uuids. Hash the bill id + kind so rescheduling the same
   reminder replaces its pending notification instead of stacking a
   duplicate alongside it. FNV-1a, clamped positive. */
export function reminderId(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h | 0) % 2147483647;
}

function parseTime(hhmm, fallbackHour) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return { hour: fallbackHour, minute: 0 };
  return { hour: Math.min(23, Number(m[1])), minute: Math.min(59, Number(m[2])) };
}

function minutesOfDay(hhmm, fallbackHour) {
  const { hour, minute } = parseTime(hhmm, fallbackHour);
  return hour * 60 + minute;
}

/* Quiet hours wrap midnight (22:00 → 08:00 is the default), so "inside the
   window" is either side of the wrap. Anything landing in there is pushed
   to the moment quiet hours end rather than dropped — a reminder that
   never fires is worse than one that arrives a few hours late. */
export function applyQuietHours(at, quietFrom, quietTo) {
  const from = minutesOfDay(quietFrom, 22);
  const to = minutesOfDay(quietTo, 8);
  if (from === to) return at;
  const mins = at.getHours() * 60 + at.getMinutes();
  const wraps = from > to;
  const inside = wraps ? mins >= from || mins < to : mins >= from && mins < to;
  if (!inside) return at;

  const out = new Date(at);
  // Past the wrap (e.g. 23:30) means quiet hours end tomorrow morning.
  if (wraps && mins >= from) out.setDate(out.getDate() + 1);
  const end = parseTime(quietTo, 8);
  out.setHours(end.hour, end.minute, 0, 0);
  return out;
}

function atDaysBefore(dueISO, days, hhmm, fallbackHour) {
  // Build from the date parts so a due date never shifts a day under a
  // timezone conversion — the same trap toLocalISODate() guards in kettle.js.
  const [y, m, d] = String(dueISO).slice(0, 10).split('-').map(Number);
  const { hour, minute } = parseTime(hhmm, fallbackHour);
  const at = new Date(y, m - 1, d, hour, minute, 0, 0);
  at.setDate(at.getDate() - (Number(days) || 0));
  return at;
}

/* Quiet hours are off when they start and end at the same time. */
export const quietHoursOn = (r = {}) => minutesOfDay(r.quietFrom, 22) !== minutesOfDay(r.quietTo, 8);

/* The coming Sunday at 18:00 (today, if it's Sunday before then). */
function nextSundayEvening(now) {
  const at = new Date(now);
  at.setDate(at.getDate() + ((7 - at.getDay()) % 7));
  at.setHours(18, 0, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 7);
  return at;
}

/* The reminders that should exist right now, soonest first.
   `now` is injectable so this can be tested without faking the clock.
   `mode` is the household's: in tracking only, nobody is chased, so
   there are no nudges. */
export function plannedReminders({ bills = [], reminders = {}, members = [], mode = 'chase', now = new Date() } = {}) {
  const out = [];
  const nudgeAfter = Number(reminders.nudgeAfter) || 0;

  bills.forEach((b) => {
    if (!OPEN[b.status] || !b.dueSort) return;
    const due = new Date(String(b.dueSort).slice(0, 10) + 'T00:00:00');
    const dayLabel = `${due.getDate()}${ordinalSuffix(due.getDate())}`;

    /* An ended bill has no next cycle to read a meter for, so the details
       nudge stops — but the payment one below keeps running, because
       ending a bill doesn't unspend what's still owed on it. */
    const everyoneAddedDetails = members.length > 0 && members.every((m) => b.details?.[m.id]?.done);
    if (b.needsDetails && !everyoneAddedDetails && !b.endedOn) {
      const label = (b.detailsLabel || 'details').toLowerCase();
      out.push({
        id: reminderId(`${b.id}:details`),
        kind: 'details',
        billId: b.id,
        title: `Add your ${label}`,
        sub: `${b.name} · everyone, ${reminders.detailsLead} days before the ${dayLabel}`,
        body: `${b.name} needs your ${label} before it lands on the ${dayLabel}.`,
        at: applyQuietHours(
          atDaysBefore(b.dueSort, reminders.detailsLead, reminders.detailsTime, 9),
          reminders.quietFrom, reminders.quietTo
        )
      });
    }

    const payerName = members.find((m) => m.id === b.payerId)?.name || 'the payer';
    const youArePayer = b.payer === 'you';
    out.push({
      id: reminderId(`${b.id}:payment`),
      kind: 'payment',
      billId: b.id,
      title: youArePayer ? 'Others send you their share' : `Send your share to ${payerName}`,
      sub: `${b.name} · ${reminders.paymentLead} days before the ${dayLabel}`,
      body: youArePayer
        ? `${b.name} is due on the ${dayLabel} — your household owes you their share.`
        : `${b.name} is due on the ${dayLabel} — send ${payerName} your share.`,
      at: applyQuietHours(
        atDaysBefore(b.dueSort, reminders.paymentLead, reminders.paymentTime, 18),
        reminders.quietFrom, reminders.quietTo
      )
    });

    /* One follow-up, a while after the money reminder, while the bill is
       still open. Each phone re-plans as soon as anything changes, so once
       the share is marked sent and confirmed the follow-up is gone. */
    if (mode !== 'track' && nudgeAfter > 0) {
      const paymentAt = atDaysBefore(b.dueSort, reminders.paymentLead, reminders.paymentTime, 18);
      out.push({
        id: reminderId(`${b.id}:nudge`),
        kind: 'nudge',
        billId: b.id,
        title: youArePayer ? `Has everyone paid for ${b.name}?` : `Still to confirm: ${b.name}`,
        sub: `${b.name} · ${nudgeAfter} hours after the money reminder`,
        body: youArePayer
          ? `Confirm the shares that have arrived for ${b.name}, so they clear from the balance.`
          : `If you've sent ${payerName} your share of ${b.name}, mark it as sent so they can confirm it.`,
        at: applyQuietHours(new Date(paymentAt.getTime() + nudgeAfter * 3600_000), reminders.quietFrom, reminders.quietTo)
      });
    }
  });

  /* When a deal is coming to an end: time to look for a better one. */
  out.push(...renewalReminders(bills, { applyQuietHours, reminderId, quietFrom: reminders.quietFrom, quietTo: reminders.quietTo, scope: 'shared' }));

  /* Sunday evening: what's due in the week ahead. */
  if (reminders.weeklyDigest !== false) {
    const at = nextSundayEvening(now);
    const weekEnd = new Date(at.getTime() + 7 * 86_400_000);
    const due = bills
      .filter((b) => OPEN[b.status] && b.dueSort)
      .map((b) => ({ b, d: new Date(String(b.dueSort).slice(0, 10) + 'T00:00:00') }))
      .filter(({ d }) => d > at && d <= weekEnd)
      .sort((x, y) => x.d - y.d);
    out.push({
      id: reminderId('weekly-digest'),
      kind: 'digest',
      billId: null,
      title: 'Your week in KTL',
      sub: 'Every Sunday at 18:00',
      body: due.length
        ? `Due this week: ${due.map(({ b, d }) => `${b.name} (${d.getDate()}${ordinalSuffix(d.getDate())})`).join(', ')}.`
        : 'Nothing due this week.',
      at
    });
  }

  return out.filter((r) => r.at > now).sort((a, b) => a.at - b.at);
}

/* Renewal reminders for your own private bills. Planned apart from the
   household's list so they only ever reach this phone's notifications —
   never the household's Alerts screen. */
export function personalRenewalReminders({ bills = [], reminders = {}, now = new Date() } = {}) {
  return renewalReminders(bills, { applyQuietHours, reminderId, quietFrom: reminders.quietFrom, quietTo: reminders.quietTo, scope: 'personal' })
    .filter((r) => r.at > now);
}
