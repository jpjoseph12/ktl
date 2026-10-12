import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* The state-loss bug this covers: the auth client reports a null session when a
   token refresh fails (typically the flaky network right after the app
   resumes), even though valid tokens are still in storage. Treating that
   as a sign-out cleared every provider's state — income, personal bills
   and debts all reverted to empty defaults — and only force-quitting the
   app brought them back, because a cold start re-reads storage. */

const listeners = [];
const getSession = vi.fn();
const refreshSession = vi.fn().mockResolvedValue({});

vi.mock('../lib/api', () => ({
  serverSendsEmail: async () => true,
  api: {
    auth: {
      getSession: (...args) => getSession(...args),
      refreshSession: (...args) => refreshSession(...args),
      onAuthStateChange: (cb) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signInWithPassword: vi.fn(),
      signOut: vi.fn()
    }
  }
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: vi.fn().mockResolvedValue({ id: 'com.ktl.app' }),
    getLaunchUrl: vi.fn().mockResolvedValue(null),
    addListener: vi.fn().mockResolvedValue({ remove: () => {} })
  }
}));

const { AuthProvider, useAuth } = await import('./AuthContext');

const SESSION = { user: { id: 'user-1', email: 'a@b.c' }, access_token: 't' };

function Probe() {
  const { user } = useAuth();
  return <div data-testid="user">{user ? user.id : 'signed-out'}</div>;
}

function renderAuth() {
  render(<AuthProvider><Probe /></AuthProvider>);
}

function emit(event, session) {
  listeners.forEach((cb) => cb(event, session));
}

describe('AuthContext — a failed token refresh must not look like a sign-out', () => {
  beforeEach(() => {
    listeners.length = 0;
    getSession.mockReset();
    refreshSession.mockClear();
  });

  it('keeps the user signed in when a null arrives but storage still has a session', async () => {
    getSession.mockResolvedValue({ data: { session: SESSION } });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-1'));

    // A failed refresh reports no session, but storage is still good.
    emit('TOKEN_REFRESHED', null);

    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('user')).toHaveTextContent('user-1');
  });

  it('still signs out for real when storage confirms the session is gone', async () => {
    getSession.mockResolvedValueOnce({ data: { session: SESSION } });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-1'));

    getSession.mockResolvedValueOnce({ data: { session: null } });
    emit('TOKEN_REFRESHED', null);

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('signed-out'));
  });

  it('signs out immediately on an explicit SIGNED_OUT without re-checking storage', async () => {
    getSession.mockResolvedValue({ data: { session: SESSION } });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-1'));

    const callsBefore = getSession.mock.calls.length;
    emit('SIGNED_OUT', null);

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('signed-out'));
    expect(getSession).toHaveBeenCalledTimes(callsBefore);
  });

  it('keeps the same user object across token refreshes so consumers do not refetch', async () => {
    getSession.mockResolvedValue({ data: { session: SESSION } });
    const seen = [];
    function IdentityProbe() {
      const { user } = useAuth();
      seen.push(user);
      return null;
    }
    render(<AuthProvider><IdentityProbe /></AuthProvider>);
    await waitFor(() => expect(seen.filter(Boolean).length).toBeGreaterThan(0));

    // A refreshed token is a brand-new session object with the same user.
    emit('TOKEN_REFRESHED', { ...SESSION, access_token: 't2' });
    await waitFor(() => expect(seen.filter(Boolean).length).toBeGreaterThan(1));

    const identities = new Set(seen.filter(Boolean));
    expect(identities.size).toBe(1);
  });
});

describe('AuthContext — the initial boot() call needs the same retry, since it runs before anything else does', () => {
  beforeEach(() => {
    listeners.length = 0;
    getSession.mockReset();
    refreshSession.mockClear();
  });

  it('retries a recoverable error on cold boot and signs the real user in', async () => {
    let calls = 0;
    getSession.mockImplementation(() => {
      calls++;
      if (calls === 1) return Promise.resolve({ data: { session: null }, error: { message: 'JWT issued at future' } });
      return Promise.resolve({ data: { session: SESSION }, error: null });
    });

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-1'), { timeout: 3000 });
    expect(refreshSession).toHaveBeenCalled();
  });

  it('does not retry a genuine, non-auth failure — fails straight to signed-out', async () => {
    let calls = 0;
    getSession.mockImplementation(() => {
      calls++;
      return Promise.resolve({ data: { session: null }, error: { message: 'permission denied' } });
    });

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('signed-out'));
    expect(calls).toBe(1);
  });

  it('does not let a slow boot retry overwrite a session the live listener already set', async () => {
    let resolveFirstCall;
    getSession.mockImplementation(
      () => new Promise((resolve) => { resolveFirstCall = resolve; })
    );

    renderAuth();
    // boot() is now awaiting its first getSession() call — before it
    // resolves, a real auth event arrives with the actual session.
    emit('SIGNED_IN', SESSION);
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-1'));

    // Only now does boot()'s original (now-stale) call resolve as signed out.
    resolveFirstCall({ data: { session: null }, error: null });
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByTestId('user')).toHaveTextContent('user-1');
  });
});
