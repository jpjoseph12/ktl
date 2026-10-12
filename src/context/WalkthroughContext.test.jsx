import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalkthroughProvider, useWalkthrough } from './WalkthroughContext';
import { useAuth } from './AuthContext';
import { useKettle } from './KettleContext';
import { usePrivate } from './PrivateContext';

vi.mock('./AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./KettleContext', () => ({ useKettle: vi.fn() }));
vi.mock('./PrivateContext', () => ({ usePrivate: vi.fn() }));

function mockK(overrides = {}) {
  return { loading: false, partner: null, data: { bills: [], lending: [] }, ...overrides };
}
function mockM(overrides = {}) {
  return { state: { income: 0, debtModule: false, debts: [], personal: [] }, ...overrides };
}

function setup() {
  return renderHook(() => useWalkthrough(), {
    wrapper: ({ children }) => (
      <MemoryRouter>
        <WalkthroughProvider>{children}</WalkthroughProvider>
      </MemoryRouter>
    )
  });
}

describe('WalkthroughContext', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuth.mockReturnValue({ user: { id: 'u1' } });
    useKettle.mockReturnValue(mockK());
    usePrivate.mockReturnValue(mockM());
  });

  it('auto-starts at "welcome" for a brand-new, never-seen household', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.active).toBe(true));
    expect(result.current.stepIndex).toBe(0);
  });

  it('does not auto-start for a household that already has bills', () => {
    useKettle.mockReturnValue(mockK({ data: { bills: [{ id: 'b1' }], lending: [] } }));
    const { result } = setup();
    expect(result.current.active).toBe(false);
  });

  it('does not auto-start twice for the same user', () => {
    localStorage.setItem('ktl:walkthrough-seen:u1', '1');
    const { result } = setup();
    expect(result.current.active).toBe(false);
  });

  it('skip() ends the tour and marks the user as seen', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.active).toBe(true));

    act(() => result.current.skip());
    expect(result.current.active).toBe(false);
    expect(localStorage.getItem('ktl:walkthrough-seen:u1')).toBe('1');
  });

  it('branches around the debt step when debtModule is off, straight to the personal-bill step', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.active).toBe(true));

    act(() => result.current.next()); // welcome -> household-people
    act(() => result.current.next()); // household-people -> add-first-bill
    act(() => result.current.next()); // add-first-bill -> add-income
    act(() => result.current.next()); // add-income -> toggle-debt
    expect(result.current.step.title).toMatch(/track a card or loan/i);

    act(() => result.current.next()); // toggle-debt -> (debtModule off) add-personal-bill
    expect(result.current.step.title).toMatch(/bill that’s just yours/i);
  });

  it('routes through add-debt when debtModule is on', async () => {
    usePrivate.mockReturnValue(mockM({ state: { income: 0, debtModule: true, debts: [], personal: [] } }));
    const { result } = setup();
    await waitFor(() => expect(result.current.active).toBe(true));

    act(() => result.current.next()); // welcome -> household-people
    act(() => result.current.next()); // household-people -> add-first-bill
    act(() => result.current.next()); // add-first-bill -> add-income
    act(() => result.current.next()); // add-income -> toggle-debt
    act(() => result.current.next()); // toggle-debt -> (debtModule on) add-debt
    expect(result.current.step.title).toMatch(/add a card or loan/i);
  });

  it('restart() re-enters at "welcome" even after being marked seen', () => {
    localStorage.setItem('ktl:walkthrough-seen:u1', '1');
    const { result } = setup();
    expect(result.current.active).toBe(false);

    act(() => result.current.restart());
    expect(result.current.active).toBe(true);
    expect(result.current.stepIndex).toBe(0);
  });

  it('auto-advances once doneWhen is satisfied for the active step', async () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = setup();
      await vi.waitFor(() => expect(result.current.active).toBe(true));

      act(() => result.current.next()); // -> household-people
      expect(result.current.step.title).toMatch(/who you share with/i);

      useKettle.mockReturnValue(mockK({ partner: { id: 'p1', name: 'Sam' } }));
      rerender();
      act(() => vi.advanceTimersByTime(600));

      expect(result.current.step.title).toMatch(/add your first shared bill/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
