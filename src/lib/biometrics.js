import { Capacitor } from '@capacitor/core';

/* Fingerprint or face, on Android only. Loaded on demand so the browser
   build never pulls the plugin in. */

async function plugin() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return (await import('@aparajita/capacitor-biometric-auth')).BiometricAuth;
  } catch {
    return null;
  }
}

/* { available, kind } — kind is 'fingerprint', 'face' or ''. */
export async function biometricsAvailable() {
  const BiometricAuth = await plugin();
  if (!BiometricAuth) return { available: false, kind: '' };
  try {
    const r = await BiometricAuth.checkBiometry();
    const types = [r.biometryType, ...(r.biometryTypes || [])].map(String).join(' ').toLowerCase();
    return { available: Boolean(r.isAvailable), kind: types.includes('face') ? 'face' : types.includes('finger') ? 'fingerprint' : '' };
  } catch {
    return { available: false, kind: '' };
  }
}

/* Resolves true if the person proved it's them, false if they cancelled
   or it failed (they can still use their PIN). */
export async function confirmWithBiometrics(reason = 'Unlock KTL') {
  const BiometricAuth = await plugin();
  if (!BiometricAuth) return false;
  try {
    await BiometricAuth.authenticate({ reason, cancelTitle: 'Use PIN', androidTitle: 'Unlock KTL', allowDeviceCredential: false });
    return true;
  } catch {
    return false;
  }
}

/* While the lock is on, hide KTL's screen in the recent-apps view (it
   still allows screenshots). */
export async function setPrivacyScreen(on) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { PrivacyScreen } = await import('@capacitor/privacy-screen');
    if (on) await PrivacyScreen.enable({ android: { preventScreenshots: false, privacyModeOnActivityHidden: 'splash' } });
    else await PrivacyScreen.disable();
  } catch { /* not available on this device */ }
}
