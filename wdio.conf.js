import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pressAndroidBack } from './e2e/helpers/context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* KTL end-to-end config.
 *
 * These tests drive the real installed app on an Android emulator against
 * a throwaway KTL server (scripts/e2e-server.mjs), going through the same
 * Connect and log-in screens a person would — so every write lands in a
 * test household on a server that is thrown away afterwards.
 *
 * The emulator, deliberately, rather than a physical device: a real phone
 * shouldn't be tied up running an automated suite against it (or worse,
 * accidentally targeted alongside a phone connected for manual testing —
 * `appium:udid` below pins this to one specific device so a second one
 * being online at the same time can't make Appium guess wrong). CI uses a
 * freshly-booted emulator too (see .github/workflows/tests.yml), so local
 * runs and CI runs are the same shape.
 *
 * Requires, in order: the test server running, an AVD booted, the debug
 * APK built, and Appium's uiautomator2 driver installed
 * (`npx appium driver install uiautomator2`). See e2e/README.md.
 */
const APK_PATH = path.join(
  __dirname,
  'android/app/build/outputs/apk/debug/app-debug.apk'
);

export const config = {
  runner: 'local',
  specs: ['./e2e/specs/**/*.e2e.js'],
  maxInstances: 1,
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  /* Confirmed live on CI: appium-chromedriver's bundled binary
     (113.0.5672.63) is a close but imperfect match for the emulator's
     actual WebView (chrome=113.0.5672.136), and under bills.e2e.js's
     heavier run of form typing/submissions this occasionally drops the
     DevTools connection outright ("disconnected: not connected to
     DevTools") — the other four, lighter spec files ran clean on the
     identical chromedriver. A hard version pin would just go stale again
     on the next emulator image update; retrying the whole spec file is
     the standard, low-maintenance mitigation for exactly this class of
     transient CI infra flakiness. */
  specFileRetries: 1,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 90000 },

  services: [
    [
      'appium',
      {
        // wdio starts and stops the Appium server itself — no separate
        // `appium` terminal needed.
        args: { relaxedSecurity: true },
        logPath: './e2e/logs'
      }
    ]
  ],

  capabilities: [
    {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:udid': process.env.ANDROID_UDID || 'emulator-5554',
      'appium:app': APK_PATH,
      'appium:appPackage': 'com.ktl.app',
      'appium:appActivity': 'com.ktl.app.MainActivity',
      /* Land directly in the WebView context. Capacitor apps are a single
         WebView, so from here on every selector is the same CSS/text
         selector already used in the Vitest component tests — no separate
         set of native locators to maintain. Native system dialogs
         (notification permission) are the one place tests still have to
         switch context deliberately; see e2e/helpers/context.js. */
      'appium:autoWebview': true,
      'appium:webviewConnectTimeout': 20000,
      'appium:chromedriverAutodownload': true,
      // Without this, getLogs('browser') in the afterTest diagnostic
      // hook below returns nothing — Chromedriver only captures console
      // output when logging is explicitly requested up front.
      'goog:loggingPrefs': { browser: 'ALL' },
      // Reinstall each run so leftover state from a previous failed run
      // (e.g. mid-onboarding) can't make a later run fail for the wrong
      // reason.
      'appium:noReset': false,
      'appium:fullReset': false,
      /* Without this, Appium skips installing the APK when one with the
         same version is already on the device — and this app's
         versionCode never changes between builds, so a local run kept
         testing whatever build was installed first (confirmed: a fixed
         bug still "failed" because the pre-fix APK was never replaced).
         Always install the APK that was just built. */
      'appium:enforceAppInstall': true,
      'appium:newCommandTimeout': 240
    }
  ],

  /* Specs share one app session (see pressAndroidBack's comment) — this
     stops a failed test's leftover open sheet from confusing the next
     one. Only runs after a FAILURE: a passing test is trusted to have
     already cleaned up after itself (closing the sheet it opened,
     removing the data it created), and running this unconditionally
     would just add a pointless key-press to every single test. */
  afterTest: async function (test, context, { passed }) {
    if (passed) return;
    try {
      const slug = test.title.replace(/[^a-z0-9]+/gi, '-');
      await browser.saveScreenshot(`./e2e/logs/FAIL-${slug}.png`);
      const src = await browser.getPageSource();
      const fs = await import('node:fs');
      fs.writeFileSync(`./e2e/logs/FAIL-${slug}.html`, src);
      /* Diagnosing a stuck "still not existing" boot failure needs to see
         WHY the household bootstrap never resolved — a network error
         (DNS, TLS, timeout) reaching the server would show up here as a
         console.error, and this is the only way to see it since the app
         itself hides raw errors from the UI by design (App.jsx's
         BootErrorScreen). */
      const logs = await browser.getLogs('browser').catch(() => null);
      if (logs) fs.writeFileSync(`./e2e/logs/FAIL-${slug}-console.json`, JSON.stringify(logs, null, 2));
    } catch { /* best-effort diagnostics, never mask the real failure */ }
    await pressAndroidBack();
  }
};
