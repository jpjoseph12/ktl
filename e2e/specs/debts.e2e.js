import { expect } from '@wdio/globals';
import { waitForWebview } from '../helpers/context.js';
import { uniqueName } from '../helpers/data.js';
import Yours from '../pageobjects/yours.page.js';

describe('Debt payoff plan', () => {
  before(async () => {
    await waitForWebview();
    await Yours.gotoYours();
    await Yours.ensureDebtModuleOn();
  });

  it('adds a card/loan and shows it in the payoff order', async () => {
    const name = uniqueName('Test Card');
    await Yours.openAddDebt();
    await Yours.fillAndSubmitDebt({ name, balance: '500', min: '25' });

    await expect(Yours.debtRowOpenBtn(name)).toBeDisplayed();

    await Yours.removeDebt(name);
    await expect(Yours.debtRowOpenBtn(name)).not.toBeExisting({ wait: 20000 });
  });

  it('will not let the monthly budget go below what the minimums already demand', async () => {
    // Regression coverage for the "user shouldn't be able to put in below
    // minimum payment" requirement — this only means something with at
    // least one debt actually in the plan, so add one first.
    const name = uniqueName('Floor Test Card');
    await Yours.openAddDebt();
    await Yours.fillAndSubmitDebt({ name, balance: '1000', min: '50' });

    await Yours.gotoYours();
    await Yours.showCategory('Debt repayment');
    await Yours.budgetOpenBtn.waitForDisplayed({ timeout: 10000 });
    await Yours.budgetOpenBtn.click();
    await Yours.budgetInput.waitForDisplayed({ timeout: 8000 });

    // £1 is below ANY real minimum-payment total once a debt exists.
    await Yours.budgetInput.setValue('1');
    await Yours.saveMoneyBtn.click();

    const wrapper = await Yours.budgetFieldWrapper;
    const classes = await wrapper.getAttribute('class');
    expect(classes).toContain('invalid');

    // The invalid state means it didn't submit — dismiss and clean up.
    await Yours.cancelMoneyBtn.click();
    await Yours.removeDebt(name);
  });
});
