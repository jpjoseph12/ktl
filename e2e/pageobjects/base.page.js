/* Selectors throughout this suite target the same accessible names the
 * Vitest component tests already assert on (aria-label, button/role text)
 * rather than CSS classes or test-ids — a change that breaks one breaks
 * both, which is the point: it keeps the two suites honest about what
 * "the button a user would actually press" is.
 */
/* Scoped to the main navigation — the phone's bottom tab bar or the
   tablet's sidebar, both labelled "Main". An unscoped a[href=…] matched
   in-page links first (Home's "Breakdown →" also goes to /android/settle,
   and sits under the FAB), so the click landed on the wrong element and
   only passed on retry. */
const nav = (path) => $(`nav[aria-label="Main"] a[href="${path}"]`);

export class BasePage {
  get navHome() { return nav('/android/home'); }
  get navBills() { return nav('/android/bills'); }
  get navSettle() { return nav('/android/settle'); }
  get navYours() { return nav('/android/yours'); }
  get navHousehold() { return nav('/android/household'); }

  /* The walkthrough tour's auto-start effect depends on a real network
     round-trip (KettleContext's household bootstrap) and can activate
     between waitForWebview()'s own dismissal and a later navigation —
     confirmed live: it intercepted a nav click in a `beforeEach` hook
     that ran well after boot had already passed. A quick existence check
     costs nothing when it's not showing, so it's cheap enough to do
     before every nav click rather than trusting the one at boot. */
  async dismissWalkthroughIfShowing() {
    const skipBtn = await $('button=Skip tour');
    if (await skipBtn.isExisting().catch(() => false)) await skipBtn.click();
  }

  /* The same specs run against a phone and a tablet emulator (see the CI
     matrix). The app picks its layout from the viewport, so the specs ask
     the page which one it rendered rather than being told up front. */
  async isTablet() {
    return $('.tablet-shell').isExisting();
  }

  /* House and Yours show one settings area at a time on a tablet, picked
     from the list pane; on a phone every area is already on the page, so
     this is a no-op there. */
  async showCategory(label) {
    if (!(await this.isTablet())) return;
    const btn = await $(`//button[contains(@class, "tablet-row") and normalize-space(.)="${label}"]`);
    await btn.waitForExist({ timeout: 10000 });
    await btn.click();
  }

  /* The screen's own title: the app bar on a phone, the topbar heading on
     a tablet. */
  async screenTitle() {
    return (await this.isTablet()) ? $('.tablet-topbar h1') : $('.appbar-title');
  }

  async gotoHome() { await this.dismissWalkthroughIfShowing(); await this.navHome.click(); }
  async gotoBills() { await this.dismissWalkthroughIfShowing(); await this.navBills.click(); }
  async gotoSettle() { await this.dismissWalkthroughIfShowing(); await this.navSettle.click(); }
  async gotoYours() { await this.dismissWalkthroughIfShowing(); await this.navYours.click(); }
  async gotoHousehold() { await this.dismissWalkthroughIfShowing(); await this.navHousehold.click(); }

  /* Sheet.jsx never puts the `id` prop it's given onto the DOM — only
     `titleId` lands there, as the id of the <h2> inside. The sheet's
     open/closed state is a CSS class (`.sheet.open`) on the <section>,
     driven by a `transform: translateY(101%)` that pushes it off-screen
     when closed rather than `display: none` — so waiting for the title
     node to be "displayed" would not reliably distinguish open from
     closed. This waits on the actual mechanism the app uses instead,
     scoped by `aria-labelledby` (which does equal titleId, and is also
     how the Vitest tests find the same dialogs via `getByRole('dialog')`).
     Pass the title id itself, e.g. "sheet-debt-title" — no leading '#'. */
  async waitForSheetOpen(titleId) {
    const sheet = await $(`section.sheet.open[aria-labelledby="${titleId}"]`);
    await sheet.waitForExist({ timeout: 8000 });
    return sheet;
  }

  /* A remove/save sheet stays open, busy, until its write to the server and the
     household refresh after it land — seconds on a CI emulator. Confirmed
     on CI: the next step's nav tap was intercepted by the still-open
     sheet's own Cancel button. Wait for the sheet to actually close. */
  async waitForSheetsClosed(timeout = 20000) {
    await browser.waitUntil(
      async () => !(await $('section.sheet.open').isExisting()),
      { timeout, timeoutMsg: `A sheet was still open after ${timeout}ms` }
    );
  }

  async toastText() {
    const toast = await $('.toast');
    await toast.waitForDisplayed({ timeout: 8000 });
    return toast.getText();
  }

  /* A single getText() right after triggering an action is a real race:
     confirmed live — a still-visible toast from the PREVIOUS action (e.g.
     "Added…" from creating the item) can still be on screen when the next
     action's toast is checked, so a one-shot read grabs stale text
     instead of failing outright. Polling for the specific substring
     rather than a fixed wait handles both a slow-to-appear new toast and
     a slow-to-clear old one. */
  /* The toast auto-hides after a fixed 3200ms (see ScreenContext's
     toast()) regardless of when it appeared — so the real risk on a slow
     CI runner isn't the toast itself being slow, it's the real server
     round-trip the action does before ever calling toast() (setStatus's
     update + logActivity + a full refresh()) pushing its appearance later
     than a tight window accounts for. Confirmed live: this failed on CI
     at the default 8s while the same flow was reliable locally. */
  async waitForToastContaining(substring, timeout = 20000) {
    await browser.waitUntil(
      async () => {
        const toast = await $('.toast');
        if (!(await toast.isExisting())) return false;
        const text = (await toast.getText()).toLowerCase();
        return text.includes(substring.toLowerCase());
      },
      { timeout, timeoutMsg: `No toast containing "${substring}" appeared within ${timeout}ms` }
    );
  }
}
