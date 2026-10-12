import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* The bug this covers: closing and reopening the app lost the Yours tab's
   data (income, personal bills, debts) while Bills/Home/Settle/Household
   came back fine after the same cold start. KettleContext already retried
   a momentarily-unusable token ("JWT issued at future", a clock-skew
   error that fixes itself) on boot; PrivateContext had no such retry, and
   since `user` doesn't change once the hiccup passes, its boot effect
   never re-ran on its own — a transient failure on the very first load
   was permanent for the rest of that session. */

vi.mock('../lib/api', () => ({
  api: {
    from: (...args) => fromMock(...args),
    auth: { refreshSession: (...args) => refreshSessionMock(...args) }
  }
}));
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: USER }) }));
vi.mock('./KettleContext', () => ({ useKettle: () => ({ data: { bills: [] } }) }));

const { PrivateProvider, usePrivate } = await import('./PrivateContext');

const USER = { id: 'user-1' };
const SETTINGS_ROW = {
  debt_module: true, income: 3000, payday: '28th', budget: 500, strategy: 'snowball',
  emergency_saved: 0, emergency_months: 3
};

const fromMock = vi.fn();
const refreshSessionMock = vi.fn().mockResolvedValue({});

/* A minimal stand-in for the four parallel `.from(...)` queries refresh()
   fires — settings resolves via the supplied resolver (so a test can make
   it fail N times then succeed), the other three always return empty. */
function tableResponse(table, settingsResolver) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    maybeSingle: () => (table === 'private_settings' ? settingsResolver() : Promise.resolve({ data: [], error: null })),
    then: (resolve) => resolve({ data: [], error: null })
  };
  return chain;
}

function mockServerWith(settingsResolver) {
  fromMock.mockImplementation((table) => tableResponse(table, settingsResolver));
}

function Probe() {
  const { loading, error, state } = usePrivate();
  if (loading) return <div data-testid="state">loading</div>;
  if (error) return <div data-testid="state">error: {error.message}</div>;
  return <div data-testid="state">income:{state.income}</div>;
}

function renderPrivate() {
  render(<PrivateProvider><Probe /></PrivateProvider>);
}

describe('PrivateContext — a momentarily-unusable token on cold start must not wipe the Yours tab', () => {
  beforeEach(() => {
    fromMock.mockReset();
    refreshSessionMock.mockClear();
  });

  it('retries a recoverable error and recovers the real data', async () => {
    let calls = 0;
    mockServerWith(() => {
      calls++;
      if (calls === 1) return Promise.resolve({ data: null, error: { message: 'JWT issued at future' } });
      return Promise.resolve({ data: SETTINGS_ROW, error: null });
    });

    renderPrivate();

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('income:3000'), { timeout: 3000 });
    expect(refreshSessionMock).toHaveBeenCalled();
  });

  it('does not silently show empty defaults after retries are exhausted — it surfaces the error', async () => {
    mockServerWith(() => Promise.resolve({ data: null, error: { message: 'JWT issued at future' } }));

    renderPrivate();

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('error:'), { timeout: 5000 });
  });

  it('does not retry a genuine, non-auth failure', async () => {
    let calls = 0;
    mockServerWith(() => {
      calls++;
      return Promise.resolve({ data: null, error: { message: 'permission denied for table private_settings' } });
    });

    renderPrivate();

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('error:'));
    expect(calls).toBe(1); // failed fast, no retry loop for a real error
  });
});
