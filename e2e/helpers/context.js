/* Everything in KTL's UI lives inside one Capacitor WebView, so specs use
 * plain CSS/text selectors throughout — the same mental model as the
 * Vitest component tests. The two exceptions are OS-drawn: the
 * notification-permission prompt and, briefly, the WebView's own loading
 * screen. Both live in the NATIVE context, so tests have to step out of
 * the WebView deliberately to handle them and back in afterwards.
 */

const WEBVIEW_PREFIX = 'WEBVIEW';

/* The throwaway test server (scripts/e2e-server.mjs) and the account it
   sets up. The emulator reaches the host machine at 10.0.2.2. */
export const E2E_SERVER = process.env.E2E_SERVER || 'http://10.0.2.2:8095';
const E2E_EMAIL = process.env.E2E_EMAIL || 'e2e-owner@ktl.test';
const E2E_PASSWORD = process.env.E2E_PASSWORD || 'e2e-password-123';

/* A fresh install starts on "which server?", then the welcome screen.
   Go through both the way a person would; on a later spec, already
   signed in, neither shows and this does nothing. */
async function connectAndSignIn() {
  const address = await $('#server-address');
  if (await address.isExisting()) {
    await address.setValue(E2E_SERVER);
    await $('button=Connect').click();
    // Connecting reloads the app against the new server.
    await browser.waitUntil(async () => !(await $('#server-address').isExisting()), { timeout: 20000 });
  }

  const logIn = await $('button=Log in');
  try {
    await logIn.waitForExist({ timeout: 15000 });
  } catch {
    return; // already signed in
  }
  await logIn.click();
  await $('#signin-email').setValue(E2E_EMAIL);
  await $('#signin-password').setValue(E2E_PASSWORD);
  await $('form button[type="submit"]').click();
}

export async function waitForWebview(timeout = 20000) {
  await browser.waitUntil(
    async () => {
      const contexts = await browser.getContexts();
      return contexts.some((c) => String(c).startsWith(WEBVIEW_PREFIX));
    },
    { timeout, timeoutMsg: 'App never exposed a WEBVIEW context — did it crash on boot?' }
  );
  const contexts = await browser.getContexts();
  const webview = contexts.find((c) => String(c).startsWith(WEBVIEW_PREFIX));
  await browser.switchContext(webview);

  if (!(await $('nav[aria-label="Main"]').isExisting())) await connectAndSignIn();

  /* Every spec file gets its own fresh Appium session (see e2e/README.md
     on `noReset: false`), and WalkthroughContext auto-starts its onboarding
     tour for any account with zero bills/lending that hasn't seen it in
     THIS install's localStorage — which is every single one of these
     fresh installs. Its dimming overlay (.walkthrough-dim) intercepts taps
     on anything outside the current step's target, including the bottom
     nav, which is exactly the click-interception every spec but this one
     hit on first run. Dismissing it the same way a real user would — the
     actual "Skip tour" button — is more honest than reaching into
     localStorage to suppress it, and just as fast. */
  // A one-shot check races the walkthrough's own auto-start effect, which
  // only fires once KettleContext's household bootstrap resolves — a real
  // network round-trip that can land after this point (confirmed live:
  // the tour appeared and blocked navigation moments after this check had
  // already passed). Poll a short window instead of checking once.
  const skipBtn = await $('button=Skip tour');
  try {
    await browser.waitUntil(() => skipBtn.isExisting(), { timeout: 6000, interval: 500 });
    await skipBtn.click();
  } catch {
    // Never appeared in the window — genuinely not showing this run.
  }

  /* Confirmed live on a CI-provisioned emulator (2 CPU cores, software
     GPU rendering, shared/throttled infra — meaningfully slower than a
     local dev machine's emulator): every single spec's very first nav
     click failed with "element wasn't found", all timing out around
     20-24s, because the app — a fresh cold install signing in over a
     real network — genuinely hadn't finished its KettleContext household
     bootstrap yet. Every spec's `before()` hook calls this function and
     then immediately tries to navigate, so waiting for the bottom nav
     bar here once, generously, fixes it everywhere at once instead of
     scattering timeout bumps across five spec files. The selector is
     duplicated from base.page.js rather than imported, to keep the
     dependency direction one-way (page objects depend on helpers, not
     the other way around). */
  const navHome = await $('nav[aria-label="Main"] a[href="/android/home"]');
  await navHome.waitForExist({ timeout: 45000 });
}

export async function inNativeContext(fn) {
  const contexts = await browser.getContexts();
  const webview = contexts.find((c) => String(c).startsWith(WEBVIEW_PREFIX));
  await browser.switchContext('NATIVE_APP');
  try {
    await fn();
  } finally {
    if (webview) await browser.switchContext(webview);
  }
}

/* Every spec file shares one app session rather than a fresh launch each
   time (relaunching would mean re-establishing the WebView context and
   re-verifying boot every single test, which is slow for no real
   benefit) — so a test that fails mid-flow with a sheet still open would
   otherwise leave it open for whatever runs next. The Android hardware
   back button is the one dismissal that works no matter which sheet it
   is, without needing to know its specific Cancel button. Swallows its
   own errors deliberately: this is best-effort cleanup, and a problem
   here must never turn into a false failure on the NEXT test. */
export async function pressAndroidBack() {
  try {
    await inNativeContext(async () => {
      await browser.pressKeyCode(4); // KEYCODE_BACK
    });
  } catch {
    /* nothing to dismiss, or the context switch itself failed — either
       way, the next test's own waits will surface the real problem. */
  }
}

/* The Android 13+ POST_NOTIFICATIONS prompt. Only appears the first time
   permission is requested in a given app install, so tests that trigger
   it must not assume it's there — a fresh install always shows it, a
   `noReset` rerun against an already-decided install won't. */
export async function acceptNativePermissionIfShown(timeout = 4000) {
  await inNativeContext(async () => {
    const allowButton = await $(
      'android=new UiSelector().resourceIdMatches(".*permission_allow.*")'
    );
    if (await allowButton.isExisting()) {
      await allowButton.waitForDisplayed({ timeout }).catch(() => {});
      if (await allowButton.isDisplayed().catch(() => false)) {
        await allowButton.click();
      }
    }
  });
}
