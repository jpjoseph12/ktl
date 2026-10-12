import { expect } from '@wdio/globals';
import { waitForWebview } from '../helpers/context.js';
import Settle from '../pageobjects/settle.page.js';

describe('Balance screen', () => {
  before(async () => {
    await waitForWebview();
    await Settle.gotoSettle();
  });

  it('renders the Balance screen with a per-person breakdown', async () => {
    await expect(await Settle.screenTitle()).toHaveText('Balance');
    // BalanceList always renders at least one row per other household
    // member, whatever the current numbers are — this is a rendering
    // smoke check, not an assertion on a specific balance figure (which
    // shifts as other specs add and remove real bills/loans).
    const rows = await $$('.row-between, .item');
    expect(rows.length).toBeGreaterThan(0);
  });
});
