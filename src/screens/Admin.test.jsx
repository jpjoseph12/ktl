import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Admin from './Admin';

const apiFetch = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args) => apiFetch(...args),
  SERVER_URL: 'https://ktl.example.com',
  IS_NATIVE: false,
  clearServer: vi.fn(),
  accountNeedsPassword: vi.fn(),
  api: { auth: { getSession: async () => ({ data: { session: null } }) } }
}));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

const DATA = {
  version: '1.1.0', siteUrl: 'https://ktl.example.com', maxPeople: 6,
  household: { id: 'h1', name: 'Flat 4', mode: 'chase', reminders: null },
  people: [{ id: 'o1', name: 'Alex', email: 'alex@example.com', role: 'owner', hasPassword: true, inHousehold: true }],
  settings: Object.fromEntries(['siteUrl', 'signup', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpSender', 'smtpSenderName', 'tunnelToken', 'trustProxy', 'backupHour', 'backupKeep', 'timezone']
    .map((k) => [k, { value: '', set: false, source: 'unset' }])),
  schedule: { hour: 3, keep: 14, timezone: 'Europe/London' },
  push: { configured: false },
  health: { healthy: true, database: true, auth: true, api: true },
  backups: []
};

const renderAdmin = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/admin" element={<Admin />} />
      <Route path="/admin/:section" element={<Admin />} />
    </Routes>
  </MemoryRouter>
);

const desktop = (on) => vi.stubGlobal('matchMedia', (query) => ({ matches: on, media: query, addEventListener() {}, removeEventListener() {} }));

describe('Admin — every server setting, in sections', () => {
  beforeEach(() => { apiFetch.mockReset(); apiFetch.mockResolvedValue(DATA); });
  afterEach(() => vi.unstubAllGlobals());

  it('on a phone, lists the sections first', async () => {
    desktop(false);
    renderAdmin('/admin');
    expect(await screen.findByText('Flat 4 · KTL 1.1.0')).toBeInTheDocument();
    for (const name of ['Overview', 'Household', 'People', 'Sign-in & address', 'Email', 'Push notifications', 'Remote access', 'Backups']) {
      expect(screen.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', expect.stringMatching(/^\/admin\//));
    }
  });

  it('on a phone, opens a section with a way back to the list', async () => {
    desktop(false);
    renderAdmin('/admin/household');
    expect(await screen.findByLabelText('Household name')).toHaveValue('Flat 4');
    expect(screen.getByRole('link', { name: /all settings/i })).toHaveAttribute('href', '/admin');
  });

  it('on a computer, starts on Overview with the sections down the side', async () => {
    desktop(true);
    renderAdmin('/admin');
    expect(await screen.findByText('All working')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute('aria-current', 'page');
  });

  it('tells someone who isn’t the owner, and offers the way back', async () => {
    desktop(false);
    apiFetch.mockRejectedValue(Object.assign(new Error('nope'), { code: 'owner_only' }));
    renderAdmin('/admin');
    expect(await screen.findByText(/Only the person who runs this server/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to KTL' })).toHaveAttribute('href', '/android/household');
  });
});
