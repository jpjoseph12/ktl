/* KTL — FCM registration.
 *
 * This is the half that local notifications can't do: being told when
 * SOMEONE ELSE does something, while the app is fully closed. The device
 * registers with FCM, we store the token against the signed-in user, and
 * the server fans out to everyone else in the household whenever an
 * activity row lands — if it has been given a Firebase project. Without
 * one (or in a build without google-services.json) this quietly does
 * nothing, and the live stream plus on-device reminders still work.
 *
 * A push token is effectively a handle to someone's phone, so the row is
 * owner-only under RLS and is cleared on sign-out — otherwise the next
 * person to sign in on this device would keep receiving the last person's
 * household notifications.
 */
import { Capacitor } from '@capacitor/core';
import { api } from './api';

let listenersBound = false;
let currentToken = null;

/* Returns the module, not the plugin — see notifications.js's plugin():
   an async function returning a Capacitor plugin Proxy rejects with
   "PushNotifications.then() is not implemented", so push registration
   never ran on a device. */
async function plugin() {
  // A build without google-services.json has no Firebase project, and
  // registering would crash the app (see vite.config.js).
  if (!Capacitor.isNativePlatform() || import.meta.env.VITE_KTL_PUSH !== 'true') return null;
  try {
    return await import('@capacitor/push-notifications');
  } catch {
    return null;
  }
}

async function saveToken(userId, token) {
  if (!userId || !token) return;
  currentToken = token;
  /* Keyed on the token, so a device that signs in as someone else moves
     the row rather than leaving a stale one pointing at the old account. */
  const { error } = await api.from('device_tokens').upsert(
    { token, user_id: userId, platform: Capacitor.getPlatform(), updated_at: new Date().toISOString() },
    { onConflict: 'token' }
  );
  if (error) console.error('Could not store push token', error);
}

/* Call once a user is signed in. Safe to call repeatedly — the listeners
   are bound only the first time, and FCM hands back the same token. */
export async function registerForPush(userId) {
  const PushNotifications = (await plugin())?.PushNotifications;
  if (!PushNotifications || !userId) return { ok: false, reason: 'unavailable' };

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return { ok: false, reason: 'not-granted' };

    if (!listenersBound) {
      listenersBound = true;
      PushNotifications.addListener('registration', (t) => { saveToken(userId, t.value); });
      PushNotifications.addListener('registrationError', (err) => {
        console.error('Push registration failed', err);
      });
      /* Delivered while the app is open. Android suppresses the tray
         notification in that case, and the in-app live stream
         already refreshes the screen, so there's nothing to do here
         beyond leaving a trace when debugging. */
      PushNotifications.addListener('pushNotificationReceived', (n) => {
        console.info('Push received in foreground', n?.title);
      });
    }

    await PushNotifications.register();
    return { ok: true };
  } catch (err) {
    console.error('Could not register for push', err);
    return { ok: false, reason: 'error' };
  }
}

/* On sign-out, drop this device's row so the next person to use the phone
   doesn't inherit the previous account's notifications. */
export async function unregisterPush() {
  if (!currentToken) return;
  const token = currentToken;
  currentToken = null;
  const { error } = await api.from('device_tokens').delete().eq('token', token);
  if (error) console.error('Could not remove push token', error);
}
