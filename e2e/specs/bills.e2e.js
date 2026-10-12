import { expect } from '@wdio/globals';
import { waitForWebview } from '../helpers/context.js';
import { uniqueName } from '../helpers/data.js';
import Bills from '../pageobjects/bills.page.js';

describe('Recurring bills', () => {
  before(async () => { await waitForWebview(); });
  beforeEach(async () => { await Bills.gotoBills(); });

  it('adds a bill with the default equal split and shows it in the list', async () => {
    const name = uniqueName('Rent');
    await Bills.openAddRecurring();
    await Bills.fillAndSubmitBill({ name, amount: '120.00' });

    // A freshly-created bill sorts by due date, so it can easily land
    // below the fold — findAndRevealItem proves it exists and scrolls to
    // it, rather than asserting toBeDisplayed() before scrolling happens.
    await Bills.findAndRevealItem(name);

    // Clean up — see e2e/helpers/data.js on why every spec that creates
    // the test household's data removes it again once it's asserted.
    // Confirmed live against the real detail sheet: "Remove this bill"
    // only exists once "Edit this bill" has opened the edit sheet — the
    // read-only detail view doesn't have it directly.
    await Bills.openItem(name);
    await Bills.removeBillViaEdit();
    // A real delete + household refresh — seconds on a CI emulator, well
    // past expect's default wait (confirmed failing there at the default).
    await expect(Bills.itemByName(name)).not.toBeExisting({ wait: 20000 });
  });

  it('supports "one pays it all" so the whole amount lands on a single person', async () => {
    const name = uniqueName('Broadband');
    await Bills.openAddRecurring();
    await Bills.nameInput.setValue(name);
    await Bills.amountInput.setValue('60.00');
    await Bills.tabOnePaysAll.waitForDisplayed({ timeout: 5000 });
    await Bills.tabOnePaysAll.click();
    await Bills.submitBillBtn.click();

    await Bills.findAndRevealItem(name);

    await Bills.openItem(name);
    await Bills.removeBillViaEdit();
  });
});

describe('Money lent (one-off IOUs)', () => {
  before(async () => { await waitForWebview(); });
  beforeEach(async () => { await Bills.gotoBills(); });

  it('adds a half-split loan and shows it in the list', async () => {
    const name = uniqueName('Takeaway');
    await Bills.openAddLending();
    await Bills.fillAndSubmitLending({ name, amount: '40.00', split: 'half' });

    await Bills.findAndRevealItem(name);

    // Default state is payer=you, payment-due — the detail view's footer
    // for that state is "Send a reminder now" / "Edit this" / "Close"
    // (confirmed live), so removal goes through the edit sheet.
    await Bills.openItem(name);
    await Bills.removeLendingViaEdit();
    await expect(Bills.itemByName(name)).not.toBeExisting({ wait: 20000 });
  });

  it('lets you record that you have sent your side of a loan', async () => {
    // Opening "Add money lent" defaults to payer=you, borrower=the other
    // member — i.e. THEY owe YOU, which only exposes an awaiting-them
    // state from this account. Flipping the payer is what makes the
    // signed-in test user the one who owes, so "I've sent" is reachable.
    const name = uniqueName('Petrol');
    await Bills.openAddLending();
    await Bills.lendingNameInput.setValue(name);
    await Bills.lendingAmountInput.setValue('25.00');
    await Bills.choosePayerOtherThanSelf();
    await Bills.lendingSubmitBtn.click();

    await Bills.openItem(name);
    const sendBtn = await $('button*=I’ve sent');
    await sendBtn.waitForDisplayed({ timeout: 8000 });
    await sendBtn.click();

    // Not a one-shot toastText() read: the "Added…" toast from creating
    // this loan moments ago can still be visible when this check runs
    // (confirmed live), so this polls until a toast actually mentioning
    // "sent" shows up rather than grabbing whatever's on screen right now.
    await Bills.waitForToastContaining('sent');

    // Now "sent" + payer='partner' from this account's view — still not
    // the read-only view's direct-remove case, same edit-sheet path.
    await Bills.openItem(name);
    await Bills.removeLendingViaEdit();
  });
});
