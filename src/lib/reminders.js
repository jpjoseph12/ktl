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

/* The reminders that should exist right now, soonest first.
   `now` is injectable so this can be tested without faking the clock. */
export function plannedReminders({ bills = [], reminders = {}, members = [], now = new Date() } = {}) {
  const out = [];

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
  });

  return out.filter((r) => r.at > now).sort((a, b) => a.at - b.at);
}
