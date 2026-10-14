import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Join from './Join';
import { useAuth } from '../context/AuthContext';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/KettleContext', () => ({ useKettle: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal()), SERVER_URL: 'https://ktl.example.com', IS_NATIVE: false }));

const TOKEN = 'Ab3_-'.repeat(9);
const VALID = { valid: true, state: 'valid', email: 'sam@example.com', name: 'Sam', household: 'Flat 4', owner: 'Alex', expiresAt: '2026-10-21T12:00:00Z' };

function server({ check = VALID, redeem = { ok: true, email: 'sam@example.com' }, redeemStatus = 200 } = {}) {
  const fetchMock = vi.fn(async (url) => {
    if (String(url).endsWith('/api/invite/check')) return { ok: true, status: 200, json: async () => check };
    return { ok: redeemStatus === 200, status: redeemStatus, json: async () => redeem };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderJoin() {
  window.history.replaceState(null, '', `/join#${TOKEN}`);
  return render(
    <MemoryRouter initialEntries={['/join']}>
      <Routes>
        <Route path="/join" element={<Join />} />
        <Route path="/android/home" element={<p>Home screen</p>} />
        <Route path="/android/onboarding" element={<p>Log in screen</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Join — using an invite', () => {
  let signIn;
  beforeEach(() => {
    signIn = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ user: null, signIn, signOut: vi.fn() });
  });
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('shows who invited them, sets the password, signs them in and takes them home', async () => {
    const user = userEvent.setup();
    const fetchMock = server();
    renderJoin();

    expect(await screen.findByRole('heading', { name: 'Join Flat 4' })).toBeInTheDocument();
    expect(screen.getByText(/Alex has invited you/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('sam@example.com');
    expect(window.location.hash).toBe('');

    await user.type(screen.getByLabelText('Choose a password'), 'a-good-password');
    await user.click(screen.getByRole('button', { name: 'Join' }));

    const [, opts] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/invite/redeem'));
    expect(JSON.parse(opts.body)).toEqual({ token: TOKEN, password: 'a-good-password' });
    expect(signIn).toHaveBeenCalledWith('sam@example.com', 'a-good-password');
    expect(await screen.findByText('Home screen')).toBeInTheDocument();
  });

  it('won’t send a password that’s too short', async () => {
    const user = userEvent.setup();
    const fetchMock = server();
    renderJoin();
    await user.type(await screen.findByLabelText('Choose a password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/invite/redeem'))).toBe(false);
  });

  it('explains an invite that has run out', async () => {
    server({ check: { valid: false, state: 'expired' } });
    renderJoin();
    expect(await screen.findByText('This invite has run out')).toBeInTheDocument();
    expect(screen.queryByLabelText('Choose a password')).not.toBeInTheDocument();
  });

  it('says so when someone else got there first', async () => {
    const user = userEvent.setup();
    server({ redeemStatus: 410, redeem: { error: 'invite_used', message: 'This invite has already been used.' } });
    renderJoin();
    await user.type(await screen.findByLabelText('Choose a password'), 'a-good-password');
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('This invite has been used')).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('asks someone logged in as another account to log out first', async () => {
    useAuth.mockReturnValue({ user: { email: 'alex@example.com' }, signIn, signOut: vi.fn() });
    server();
    renderJoin();
    expect(await screen.findByText(/logged in as alex@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out to accept it' })).toBeInTheDocument();
  });
});
