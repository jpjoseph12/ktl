import { BasePage } from './base.page.js';

class SettlePage extends BasePage {
  // BalanceList (shared by Home's summary and this screen) renders one row
  // per other member: name in .legend, the signed amount in .amount.num.
  balanceRowFor(name) {
    return $(`//*[contains(@class,"row-between")][contains(., "${name}")]`);
  }

  async openSettleWith(name) {
    const row = await this.balanceRowFor(name);
    await row.waitForDisplayed({ timeout: 10000 });
    await row.click();
    await this.waitForSheetOpen('sheet-settle-title');
  }
}

export default new SettlePage();
