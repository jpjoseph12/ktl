import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLockProvider } from './AppLockContext';
import { useAuth } from './AuthContext';
import { setPin, updateLock } from '../lib/appLock';

vi.mock('./AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/biometrics', () => ({ setPrivacyScreen: vi.fn(), confirmWithBiometrics: vi.fn().mockResolvedValue(false) }));

const app = () => render(<AppLockProvider><p>The app</p></AppLockProvider>);
const isLocked = () => Boolean(screen.queryByRole('dialog', { name: 'KTL is locked' }));

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('AppLockProvider', () => {
  beforeEach(() => useAuth.mockReturnValue({ user: { id: 'u1' }, loading: false, signOut: vi.fn() }));
  afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it('locks when KTL opens with someone already signed in and a lock set', async () => {
    await setPin('u1', '2468');
    app();
    expect(isLocked()).toBe(true);
  });

  it('doesn’t lock without a lock set', () => {
    app();
    expect(isLocked()).toBe(false);
    expect(screen.getByText('The app')).toBeInTheDocument();
  });

  it('doesn’t ask for the PIN straight after signing in with a password', async () => {
    await setPin('u1', '2468');
    useAuth.mockReturnValue({ user: null, loading: false, signOut: vi.fn() });
    const { rerender } = app();
    useAuth.mockReturnValue({ user: { id: 'u1' }, loading: false, signOut: vi.fn() });
    rerender(<AppLockProvider><p>The app</p></AppLockProvider>);
    expect(isLocked()).toBe(false);
  });

  it('locks again after being away longer than chosen, not before', async () => {
    await setPin('u1', '2468');
    updateLock('u1', { after: 60 });
    useAuth.mockReturnValue({ user: null, loading: false, signOut: vi.fn() });
    const { rerender } = app();
    useAuth.mockReturnValue({ user: { id: 'u1' }, loading: false, signOut: vi.fn() });
    rerender(<AppLockProvider><p>The app</p></AppLockProvider>);

    vi.useFakeTimers({ toFake: ['Date'] });
    act(() => setVisibility('hidden'));
    vi.setSystemTime(Date.now() + 30_000);
    act(() => setVisibility('visible'));
    expect(isLocked()).toBe(false);

    act(() => setVisibility('hidden'));
    vi.setSystemTime(Date.now() + 120_000);
    act(() => setVisibility('visible'));
    expect(isLocked()).toBe(true);
  });
});
