import { BasePage } from './base.page.js';

/* WebdriverIO's `tag=text` / `tag*=text` shorthand only accepts a bare tag
   name before the `=` — it can't be combined with a class or attribute
   selector in the same string. Anywhere a lookup needs both (e.g. "a
   button with role=tab that contains this text"), this file drops to
   plain XPath instead, rather than writing a selector that looks
   plausible but silently isn't valid. */
class BillsPage extends BasePage {
  get fab() { return $('button=Add a cost'); }
  get chooserRecurring() { return $('button*=Recurring cost'); }
  get chooserLending() { return $('button*=Money lent'); }

  // Add/edit recurring bill sheet
  get nameInput() { return $('#new-name'); }
  get amountInput() { return $('#new-amount'); }
  get submitBillBtn() { return $('button*=Add and start reminders'); }
  // Split-mode tabs: role="tab" buttons, matched by their visible label.
  get tabEqual() { return $('//button[@role="tab" and contains(., "Equal (")]'); }
  get tabOnePaysAll() { return $('button=One pays it all'); }
  get tabCustom() { return $('//button[@role="tab" and contains(., "Custom %")]'); }

  // Lending sheet
  get lendingNameInput() { return $('#lend-name'); }
  get lendingAmountInput() { return $('#lend-amount'); }
  get lendingPayerSelect() { return $('#lend-payer'); }
  get lendingSplitFull() { return $('button=All of it'); }
  get lendingSplitHalf() { return $('button=Half each'); }
  get lendingSubmitBtn() {
    return $('//section[@aria-labelledby="sheet-lend-title"]//button[text()="Add" or text()="Save changes"]');
  }
  get editThisBtn() { return $('button=Edit this'); }
  get editThisBillBtn() { return $('button=Edit this bill'); }
  // Lives in the EDIT sheet (sheet-lend), not the read-only detail view —
  // the detail view's own footer varies by status (confirmed live: a
  // payment-due item you're owed shows "Send a reminder now" / "Edit
  // this" / "Close", nothing else), so reaching Remove always means
  // opening the edit sheet first via "Edit this".
  get lendingRemoveBtn() { return $('button=Remove this'); }

  /* Opening "Add money lent" always defaults payer=you, borrower=the
     other member (Bills.jsx's reset picks `others[0]`) — i.e. THEY owe
     YOU. To test the "I've sent" side instead, the payer has to be
     flipped to the other member, which (via onLendingPayerChange)
     auto-bumps the borrower back to you. The other member's real name
     isn't known statically, so this picks whichever <option> isn't "You"
     rather than hard-coding a display name that could change. */
  async choosePayerOtherThanSelf() {
    const options = await this.lendingPayerSelect.$$('option');
    for (let i = 0; i < options.length; i++) {
      const text = (await options[i].getText()).trim();
      if (text !== 'You') {
        await this.lendingPayerSelect.selectByIndex(i);
        return text;
      }
    }
    throw new Error('No other household member to pick as payer — the test household needs 2+ members for this flow.');
  }

  itemByName(name) {
    return $(`//button[contains(@class, "item") and contains(., "${name}")]`);
  }

  /* The actual root cause, proven directly against the database rather
     than assumed: the recurring list only renders its first
     RECURRING_PREVIEW_COUNT (6) items until "Show N more" is tapped
     (Bills.jsx's `shownRecurring`/`showAllRecurring`). A freshly-created
     bill defaults to day-1-of-next-month, which sorts LAST by due date —
     so on a household with 6+ existing bills it never enters the DOM at
     all, no matter how long you wait. A first attempt at this test spent
     a long time chasing a "maybe it just needs longer" theory before a
     direct database check settled it: the bill existed in Postgres the
     whole time; the client-side page-size cap was the only reason it
     never rendered. */
  async findAndRevealItem(name, timeout = 15000) {
    const item = await this.itemByName(name);
    if (!(await item.isExisting())) {
      const showMore = await $('button*=Show');
      if (await showMore.isExisting().catch(() => false)) await showMore.click();
    }
    await item.waitForExist({ timeout });
    await item.scrollIntoView();
    return item;
  }

  async openAddRecurring() {
    await this.fab.waitForDisplayed({ timeout: 10000 });
    await this.fab.click();
    await this.chooserRecurring.waitForDisplayed({ timeout: 5000 });
    await this.chooserRecurring.click();
    await this.waitForSheetOpen('sheet-add-title');
  }

  async openAddLending() {
    await this.fab.waitForDisplayed({ timeout: 10000 });
    await this.fab.click();
    await this.chooserLending.waitForDisplayed({ timeout: 5000 });
    await this.chooserLending.click();
    await this.waitForSheetOpen('sheet-lend-title');
  }

  async fillAndSubmitBill({ name, amount }) {
    await this.nameInput.setValue(name);
    await this.amountInput.setValue(String(amount));
    await this.submitBillBtn.click();
  }

  async fillAndSubmitLending({ name, amount, split = 'full' }) {
    await this.lendingNameInput.setValue(name);
    await this.lendingAmountInput.setValue(String(amount));
    if (split === 'half') await this.lendingSplitHalf.click();
    await this.lendingSubmitBtn.click();
  }

  /* On a phone a bill's detail opens as a sheet; on a tablet it fills the
     right-hand pane instead, with the same buttons — so the rest of a flow
     ("Edit this bill", "I've sent …") is identical either way. */
  async openItem(name) {
    const item = await this.findAndRevealItem(name);
    await item.click();
    if (await this.isTablet()) {
      await browser.waitUntil(
        async () => (await $('.tablet-detail-pane').getText()).includes(name),
        { timeout: 8000, timeoutMsg: `Detail pane never showed "${name}"` }
      );
      return;
    }
    await this.waitForSheetOpen('sheet-bill-title');
  }

  /* Removal always goes through the edit sheet — see lendingRemoveBtn's
     comment. Call this after openItem() has already opened the read-only
     detail view for a lending item. */
  async removeLendingViaEdit() {
    await this.editThisBtn.waitForDisplayed({ timeout: 8000 });
    await this.editThisBtn.click();
    await this.waitForSheetOpen('sheet-lend-title');
    await this.lendingRemoveBtn.waitForDisplayed({ timeout: 8000 });
    await this.lendingRemoveBtn.click();
    await this.waitForSheetsClosed();
  }

  /* Same shape as removeLendingViaEdit(), for a recurring bill: "Remove
     this bill" lives in sheet-add's edit mode (editingBillId truthy), not
     the read-only sheet-bill detail view — confirmed against the actual
     JSX, not assumed from the button text alone. */
  async removeBillViaEdit() {
    await this.editThisBillBtn.waitForDisplayed({ timeout: 8000 });
    await this.editThisBillBtn.click();
    await this.waitForSheetOpen('sheet-add-title');
    const removeBtn = await $('button=Remove this bill');
    await removeBtn.waitForDisplayed({ timeout: 8000 });
    await removeBtn.click();
    await this.waitForSheetsClosed();
  }
}

export default new BillsPage();
