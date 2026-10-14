import { afterEach, describe, expect, it } from 'vitest';
import { clearLock, MAX_TRIES, readLock, resetFails, setPin, shouldRelock, updateLock, validPin, verifyPin } from './appLock';

describe('appLock', () => {
  afterEach(() => localStorage.clear());

  it('only takes 4 to 6 digits', () => {
    expect(validPin('1234')).toBe(true);
    expect(validPin('123456')).toBe(true);
    expect(validPin('123')).toBe(false);
    expect(validPin('1234567')).toBe(false);
    expect(validPin('12a4')).toBe(false);
  });

  it('never stores the PIN, only a salted hash', async () => {
    await setPin('u1', '2468');
    const raw = localStorage.getItem('ktl.lock.v1:u1');
    expect(raw).not.toContain('2468');
    const lock = readLock('u1');
    expect(lock.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(lock.length).toBe(4);
  });

  it('checks a PIN and counts wrong tries, which a right one resets', async () => {
    await setPin('u1', '2468');
    expect(await verifyPin('u1', '1111')).toEqual({ ok: false, remaining: MAX_TRIES - 1 });
    expect(await verifyPin('u1', '2222')).toEqual({ ok: false, remaining: MAX_TRIES - 2 });
    expect(await verifyPin('u1', '2468')).toEqual({ ok: true, remaining: MAX_TRIES });
    await verifyPin('u1', '1111');
    resetFails('u1');
    expect(readLock('u1').fails).toBe(0);
  });

  it('keeps each person’s lock to themselves', async () => {
    await setPin('u1', '2468');
    expect(readLock('u2')).toBeNull();
    clearLock('u1');
    expect(readLock('u1')).toBeNull();
  });

  it('keeps the options when the PIN changes', async () => {
    await setPin('u1', '2468', { biometrics: true, after: 300 });
    updateLock('u1', { after: 60 });
    await setPin('u1', '135790');
    expect(readLock('u1')).toMatchObject({ biometrics: true, after: 60, length: 6 });
  });

  it('locks again only after being away for the chosen time', () => {
    expect(shouldRelock({ after: 60 }, 30)).toBe(false);
    expect(shouldRelock({ after: 60 }, 61)).toBe(true);
    expect(shouldRelock({ after: 0 }, 0)).toBe(true);
    expect(shouldRelock(null, 999)).toBe(false);
  });
});
