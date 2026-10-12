import { expect } from '@wdio/globals';
import { waitForWebview } from '../helpers/context.js';
import Bills from '../pageobjects/bills.page.js';

/* Foundation test: if this fails, nothing else in the suite can be
   trusted either, since it proves the one thing every other spec
   assumes — a fresh install connects to the test server, signs in, and
   reaches the WebView with the real app rendered inside it. */
describe('App boot', () => {
  it('launches, connects to the server, signs in, and lands on a real screen', async () => {
    // waitForWebview() itself already waits (generously, for a real
    // cold-start network round-trip) for the bottom nav to exist before
    // returning — see its own comment — so existence here is already
    // guaranteed. What's actually being proven is that ALL FIVE tabs
    // rendered, not just the one waitForWebview happened to check.
    await waitForWebview();
    await expect(Bills.navHome).toBeExisting();
    await expect(Bills.navBills).toBeExisting();
    await expect(Bills.navSettle).toBeExisting();
    await expect(Bills.navYours).toBeExisting();
    await expect(Bills.navHousehold).toBeExisting();
  });

  /* CI runs this whole suite on a phone and on a tablet emulator. Pin that
     each one actually got the layout meant for its size — otherwise a
     broken breakpoint would quietly run the "tablet" job against the phone
     layout and still pass. Thresholds mirror src/lib/useIsTablet.js. */
  it('renders the layout meant for this screen size', async () => {
    const { w, h } = await browser.execute(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const wantsTablet = w >= 1000 && h >= 600;
    if (wantsTablet) {
      await expect($('.tablet-shell .tablet-sidebar')).toBeExisting();
      await expect($('.md-navbar')).not.toBeExisting();
    } else {
      await expect($('.md-navbar')).toBeExisting();
      await expect($('.tablet-shell')).not.toBeExisting();
    }
    // No mock device chrome in either layout — the real OS draws its own.
    await expect($('.md-status')).not.toBeExisting();
    await expect($('.md-gesture')).not.toBeExisting();
  });

  it('never shows the boot-error screen on a clean launch', async () => {
    // App.jsx's BootErrorScreen — deliberately not an assertion on the
    // *raw* internal error, which the app now hides from the user by
    // design (see App.jsx's BootErrorScreen comment): just that this
    // dead-end state isn't showing at all right after a clean launch.
    await expect($('p*=Something went wrong.')).not.toBeExisting();
    await expect($('p*=No connection.')).not.toBeExisting();
  });
});
