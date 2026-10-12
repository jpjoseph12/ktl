import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSnoozed, snoozeUntilLater } from './snooze';

/* The bug this fixes: "Snooze" on the Alerts screen showed a toast
   ("Snoozed until later today") but changed nothing — the item was back
   on the very next render, indistinguishable from Snooze doing nothing at
   all. This is the real, persisted mechanism behind it. */
describe('snooze — a real, expiring dismissal instead of a toast that lies', () => {
  beforeEach(() => { localStorage.clear(); });

  it('is not snoozed before anyone has snoozed it', () => {
    expect(isSnoozed('user-1', 'pay:bill-1')).toBe(false);
  });

  it('is snoozed immediately after snoozing', () => {
    snoozeUntilLater('user-1', 'pay:bill-1');
    expect(isSnoozed('user-1', 'pay:bill-1')).toBe(true);
  });

  it('expires on its own — nothing has to actively un-snooze it', () => {
    snoozeUntilLater('user-1', 'pay:bill-1');
    const farFuture = Date.now() + 7 * 60 * 60 * 1000; // 7h — past the 6h window
    expect(isSnoozed('user-1', 'pay:bill-1', farFuture)).toBe(false);
  });

  it('is scoped per user — one person snoozing does not hide it from another', () => {
    snoozeUntilLater('user-1', 'pay:bill-1');
    expect(isSnoozed('user-2', 'pay:bill-1')).toBe(false);
  });

  it('is scoped per key — snoozing one reason for an item does not snooze a different reason', () => {
    snoozeUntilLater('user-1', 'pay:bill-1');
    expect(isSnoozed('user-1', 'details:bill-1')).toBe(false);
  });

  it('degrades safely with no userId — never claims something is snoozed when it cannot know', () => {
    expect(isSnoozed(undefined, 'pay:bill-1')).toBe(false);
    snoozeUntilLater(undefined, 'pay:bill-1'); // must not throw
  });

  it('degrades safely if localStorage itself is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(isSnoozed('user-1', 'pay:bill-1')).toBe(false);
    spy.mockRestore();
  });
});
