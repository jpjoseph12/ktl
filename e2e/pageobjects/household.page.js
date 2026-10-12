import { BasePage } from './base.page.js';

class HouseholdPage extends BasePage {
  get whosInHeading() { return $('h2=Who’s in'); }
  // NotificationSetting reads the real OS permission (permissionState()),
  // so this is a button — "Turn on" — not a settings switch, and it only
  // renders once the permission check has resolved past "checking".
  get notificationsTurnOnBtn() { return $('button=Turn on'); }
  get notificationsRow() { return $('//div[contains(@class,"item")][contains(., "Reminders on this device")]'); }

  /* The Household screen is long — members, mode selection, reminder
     settings — and NotificationSetting sits well below the fold.
     Confirmed live via screenshot: it genuinely exists, just off-screen,
     the same class of bug the recurring-bills list had for the same
     reason (waitForDisplayed doesn't scroll; only click() does). */
  async revealNotificationsRow(timeout = 10000) {
    await this.showCategory('Reminders');
    await this.notificationsRow.waitForExist({ timeout });
    await this.notificationsRow.scrollIntoView();
    await this.notificationsRow.waitForDisplayed({ timeout: 5000 });
  }
}

export default new HouseholdPage();
