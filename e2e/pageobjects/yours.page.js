import { BasePage } from './base.page.js';

class YoursPage extends BasePage {
  get debtModuleSwitch() { return $('button[role="switch"][aria-label="Debt repayment"]'); }
  get addDebtBtn() { return $('button*=Add a card or loan'); }
  get nameInput() { return $('#d-name'); }
  get balanceInput() { return $('#d-balance'); }
  get minInput() { return $('#d-min'); }
  get aprInput() { return $('#d-apr'); }
  get saveDebtBtn() { return $('//section[@aria-labelledby="sheet-debt-title"]//button[text()="Save"]'); }
  get removeDebtBtn() { return $('button*=Remove this account'); }

  // "Save"/"Cancel" are not unique text on this screen — the debt sheet,
  // the personal-bill sheet and this one all have a button with exactly
  // that label. Every OTHER sheet in the DOM is still present, just
  // pushed off-screen (see base.page.js's note on Sheet.jsx), so a bare
  // `$('button=Save')` risks resolving to a different, closed sheet
  // entirely. Scope to this sheet's own <section> via aria-labelledby.
  get budgetOpenBtn() { return $('button*=Monthly budget'); }
  get saveMoneyBtn() { return $('//section[@aria-labelledby="sheet-money-title"]//button[text()="Save"]'); }
  get cancelMoneyBtn() { return $('//section[@aria-labelledby="sheet-money-title"]//button[text()="Cancel"]'); }
  get budgetInput() { return $('#in-budget'); }
  // The wrapping .field div gains an "invalid" class when the typed
  // budget is below the minimums total — that's what the enforcement
  // test asserts on, since the field never lets a below-minimum value
  // actually submit.
  get budgetFieldWrapper() {
    return $('//label[@for="in-budget"]/parent::div[contains(@class,"field")]');
  }

  /* The debt row is a <div class="item"> wrapping a <button class="grow">
     (opens the edit sheet) alongside a sibling "Still correct" button —
     two tap targets in one row, which is why it isn't a single <button>
     the way most list items are. */
  debtRowOpenBtn(name) {
    return $(`//div[contains(@class, "item")][contains(., "${name}")]//button[contains(@class, "grow")]`);
  }

  stillCorrectBtnFor(name) {
    // The "Still correct" action sits beside (not inside) the debt's own
    // open-sheet button, in the same row — see Yours.jsx's debt list markup.
    return $(
      `//div[contains(@class, "item") and contains(., "${name}")]//button[contains(., "Still correct")]`
    );
  }

  /* The whole debt section — including "Add a card or loan" — only
     renders when this switch is on (Yours.jsx: `{on && (...)}`). The test
     account's state here isn't something a test should assume either way,
     so specs call this before touching anything debt-related rather than
     hard-coding an assumption that later drifts as the test data changes. */
  async ensureDebtModuleOn() {
    await this.showCategory('Debt repayment');
    const sw = await this.debtModuleSwitch;
    await sw.waitForDisplayed({ timeout: 10000 });
    const isOn = (await sw.getAttribute('aria-checked')) === 'true';
    if (!isOn) await sw.click();
    await this.addDebtBtn.waitForDisplayed({ timeout: 5000 });
  }

  async openAddDebt() {
    await this.addDebtBtn.waitForDisplayed({ timeout: 10000 });
    await this.addDebtBtn.click();
    await this.waitForSheetOpen('sheet-debt-title');
  }

  async fillAndSubmitDebt({ name, balance, min, apr = '0' }) {
    await this.nameInput.setValue(name);
    await this.balanceInput.setValue(String(balance));
    await this.minInput.setValue(String(min));
    if (apr !== '0') await this.aprInput.setValue(String(apr));
    await this.saveDebtBtn.click();
  }

  async removeDebt(name) {
    await this.openDebt(name);
    await this.removeDebtBtn.click();
    await this.waitForSheetsClosed();
  }

  async openDebt(name) {
    const btn = await this.debtRowOpenBtn(name);
    await btn.waitForDisplayed({ timeout: 10000 });
    await btn.click();
    await this.waitForSheetOpen('sheet-debt-title');
  }
}

export default new YoursPage();
