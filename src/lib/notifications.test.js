import { describe, expect, it, vi } from 'vitest';

/* A real Capacitor plugin is a Proxy that answers to ANY method name —
   including then(), which it implements by throwing. Returning one from an
   async function makes the promise treat it as a thenable and reject, which
   is what broke permission checks, reminder scheduling and push
   registration on every device. These mocks behave the same way. */
function capacitorPluginProxy(name, methods) {
  return new Proxy({}, {
    get(_, prop) {
      if (prop in methods) return methods[prop];
      return () => { throw new Error(`"${name}.${String(prop)}()" is not implemented on android`); };
    }
  });
}

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' }
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: capacitorPluginProxy('LocalNotifications', {
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
    createChannel: async () => {},
    getPending: async () => ({ notifications: [] }),
    schedule: vi.fn(async () => ({}))
  })
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: capacitorPluginProxy('PushNotifications', {
    checkPermissions: async () => ({ receive: 'granted' }),
    addListener: () => ({ remove: () => {} }),
    register: vi.fn(async () => {})
  })
}));

vi.mock('./api', () => ({ api: { from: () => ({ upsert: async () => ({}), delete: () => ({ eq: async () => ({}) }) }) } }));

const { permissionState, requestPermission, syncReminders, notificationsAvailable } = await import('./notifications');
const { registerForPush } = await import('./push');

describe('native plugins reached through a lazy import', () => {
  it('reads the real permission instead of rejecting on the plugin’s then()', async () => {
    await expect(notificationsAvailable()).resolves.toBe(true);
    await expect(permissionState()).resolves.toBe('granted');
    await expect(requestPermission()).resolves.toBe('granted');
  });

  it('schedules reminders once permission is granted', async () => {
    const at = new Date(Date.now() + 60_000);
    const result = await syncReminders([{ id: 1, title: 'Rent', body: 'Send £700', at, billId: 'b1', kind: 'pay' }]);
    expect(result).toEqual({ scheduled: 1, reason: 'ok' });
  });

  it('registers for push when the build has a Firebase project', async () => {
    vi.stubEnv('VITE_KTL_PUSH', 'true');
    await expect(registerForPush('user-1')).resolves.toEqual({ ok: true });
    vi.unstubAllEnvs();
  });

  it('leaves push alone in a build without one, instead of crashing the app', async () => {
    vi.stubEnv('VITE_KTL_PUSH', 'false');
    await expect(registerForPush('user-1')).resolves.toEqual({ ok: false, reason: 'unavailable' });
    vi.unstubAllEnvs();
  });
});
