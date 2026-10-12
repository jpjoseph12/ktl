/* KTL — the bridge between the planned reminder list and the OS.
 *
 * These are LOCAL notifications: the device schedules them itself from
 * data it already has, so they fire whether or not the app is running and
 * without any server. That covers everything predictable from a due date
 * — "send your share", "add your meter reading".
 *
 * What local notifications deliberately cannot cover: anything triggered
 * by someone ELSE's action on their own phone ("Sam marked £20 as sent",
 * "nobody confirmed after 24 hours"). Those need push plus a server-side
 * scheduler, which this app doesn't have yet.
 */
import { Capacitor } from '@capacitor/core';

const CHANNEL_ID = 'ktl-reminders';

/* Imported lazily so the web build never pulls the native plugin in, and
   so a missing plugin can't take the whole app down at import time.

   Returns the module, never the plugin itself: a Capacitor plugin is a
   Proxy that answers to every method name, then() included, so returning
   it from an async function makes the promise adopt it as a thenable —
   which throws "LocalNotifications.then() is not implemented" and rejected
   every caller. That's what left the reminders row stuck on "Checking…". */
async function plugin() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await import('@capacitor/local-notifications');
  } catch {
    return null;
  }
}

export async function notificationsAvailable() {
  return (await plugin()) !== null;
}

export async function permissionState() {
  const LocalNotifications = (await plugin())?.LocalNotifications;
  if (!LocalNotifications) return 'unavailable';
  try {
    const { display } = await LocalNotifications.checkPermissions();
    return display; // 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
  } catch {
    return 'unavailable';
  }
}

export async function requestPermission() {
  const LocalNotifications = (await plugin())?.LocalNotifications;
  if (!LocalNotifications) return 'unavailable';
  try {
    const { display } = await LocalNotifications.requestPermissions();
    if (display === 'granted') await ensureChannel(LocalNotifications);
    return display;
  } catch {
    return 'unavailable';
  }
}

/* Android 8+ groups notifications by channel; without one created up
   front the OS silently drops them. */
async function ensureChannel(LocalNotifications) {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Bill reminders',
      description: 'Reminders to send your share and add bill details',
      importance: 4,
      visibility: 1
    });
  } catch {
    // Channel already exists, or the OS refused — scheduling still works.
  }
}

/* Replaces the whole pending set with `reminders`. Cancel-then-schedule
   rather than diffing: the list is small, and a bill whose amount, due
   date or payer changed must never leave a stale reminder promising the
   old figure. */
export async function syncReminders(reminders) {
  const LocalNotifications = (await plugin())?.LocalNotifications;
  if (!LocalNotifications) return { scheduled: 0, reason: 'unavailable' };

  const { display } = await LocalNotifications.checkPermissions();
  if (display !== 'granted') return { scheduled: 0, reason: 'not-granted' };

  await ensureChannel(LocalNotifications);

  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    }
  } catch {
    // Nothing pending, or the OS wouldn't say — scheduling below still stands.
  }

  if (!reminders.length) return { scheduled: 0, reason: 'nothing-due' };

  await LocalNotifications.schedule({
    notifications: reminders.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      channelId: CHANNEL_ID,
      schedule: { at: r.at, allowWhileIdle: true },
      extra: { billId: r.billId, kind: r.kind }
    }))
  });

  return { scheduled: reminders.length, reason: 'ok' };
}

/* Fires straight away, for something that has just happened rather than
   something scheduled — "Sam marked £20 as sent". Uses a rolling id so a
   burst of updates stacks rather than overwriting one another. */
let liveId = 900000;
export async function notifyNow(title, body, extra) {
  const LocalNotifications = (await plugin())?.LocalNotifications;
  if (!LocalNotifications) return false;
  try {
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== 'granted') return false;
    await ensureChannel(LocalNotifications);
    liveId = liveId >= 999999 ? 900000 : liveId + 1;
    await LocalNotifications.schedule({
      notifications: [{
        id: liveId,
        title,
        body,
        channelId: CHANNEL_ID,
        // A second out, rather than no schedule at all: some Android
        // builds drop an immediate notification scheduled for "now".
        schedule: { at: new Date(Date.now() + 1000) },
        extra: extra || {}
      }]
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelAllReminders() {
  const LocalNotifications = (await plugin())?.LocalNotifications;
  if (!LocalNotifications) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    }
  } catch {
    // Nothing to cancel.
  }
}
