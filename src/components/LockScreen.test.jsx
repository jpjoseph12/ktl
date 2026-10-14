import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LockScreen from './LockScreen';
import { readLock, setPin } from '../lib/appLock';

const signOut = vi.fn().mockResolvedValue();
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ signOut }) }));
vi.mock('../lib/biometrics', () => ({ confirmWithBiometrics: vi.fn().mockResolvedValue(false) }));

async function typePin(user, pin) {
  for (const d of pin) await user.click(screen.getByRole('button', { name: d }));
}

describe('LockScreen', () => {
  beforeEach(async () => {
    signOut.mockClear();
    await setPin('u1', '2468');
  });
  afterEach(() => localStorage.clear());

  it('unlocks with the right PIN', async () => {
    const user = userEvent.setup();
    const onUnlock = vi.fn();
    render(<LockScreen userId="u1" lock={readLock('u1')} onUnlock={onUnlock} />);
    expect(screen.getByRole('heading', { name: 'KTL is locked' })).toBeInTheDocument();
    await typePin(user, '2468');
    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
  });

  it('says how many tries are left after a wrong PIN', async () => {
    const user = userEvent.setup();
    const onUnlock = vi.fn();
    render(<LockScreen userId="u1" lock={readLock('u1')} onUnlock={onUnlock} />);
    await typePin(user, '1111');
    expect(await screen.findByText('Wrong PIN. 4 tries left.')).toBeInTheDocument();
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('logs out after five wrong PINs, and forgets the lock', async () => {
    const user = userEvent.setup();
    render(<LockScreen userId="u1" lock={readLock('u1')} onUnlock={vi.fn()} />);
    for (let i = 0; i < 5; i++) {
      await typePin(user, '1111');
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(screen.getByLabelText(/0 of 4 digits/)).toBeInTheDocument());
    }
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(readLock('u1')).toBeNull();
  });

  it('lets someone who forgot their PIN log out instead', async () => {
    const user = userEvent.setup();
    render(<LockScreen userId="u1" lock={readLock('u1')} onUnlock={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /forgot your pin/i }));
    expect(signOut).toHaveBeenCalled();
    expect(readLock('u1')).toBeNull();
  });
});
