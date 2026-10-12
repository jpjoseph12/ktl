import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Setup from './Setup';

const signIn = vi.fn().mockResolvedValue();
const apiFetch = vi.fn();
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ signIn }) }));
vi.mock('../context/KettleContext', () => ({ useKettle: vi.fn() }));
vi.mock('../lib/api', () => ({
  SERVER_URL: 'https://ktl.example.com',
  apiFetch: (...args) => apiFetch(...args),
  api: { auth: { getSession: async () => ({ data: { session: null } }) } }
}));

const OVERVIEW = {
  version: '1.0.0', siteUrl: 'https://ktl.example.com', household: { id: 'h1', name: 'Flat 4' }, maxPeople: 6,
  people: [{ id: 'o1', name: 'Alex Rivera', email: 'alex@example.com', role: 'owner', hasPassword: true, inHousehold: true }],
  settings: {
    siteUrl: { value: 'https://ktl.example.com', set: true, source: 'settings' }, signup: { value: 'false', set: true, source: 'settings' },
    smtpHost: { value: '', set: false, source: 'unset' }, smtpPort: { value: '', set: false, source: 'unset' },
    smtpUser: { value: '', set: false, source: 'unset' }, smtpPass: { value: '', set: false, source: 'unset' },
    smtpSender: { value: '', set: false, source: 'unset' }, tunnelToken: { value: '', set: false, source: 'unset' }
  },
  push: { configured: false, projectId: null, fromContainer: false },
  backups: []
};

function server({ ready = false, claim = { ok: true, siteUrl: 'https://ktl.example.com' }, claimStatus = 200 } = {}) {
  const fetchMock = vi.fn(async (url) => {
    if (String(url).endsWith('/api/setup')) return { ok: true, json: async () => ({ ready, accounts: 0 }) };
    return { ok: claimStatus === 200, status: claimStatus, json: async () => claim };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const renderSetup = () => render(<MemoryRouter><Setup /></MemoryRouter>);

async function fillClaim(user) {
  await user.click(await screen.findByRole('button', { name: 'Start' }));
  await user.type(screen.getByLabelText('Setup code'), 'ABCD-EF23');
  await user.type(screen.getByLabelText('Household name'), 'Flat 4');
  await user.type(screen.getByLabelText('Your name'), 'Alex Rivera');
  await user.type(screen.getByLabelText('Your email'), 'alex@example.com');
  await user.type(screen.getByLabelText('Password'), 'a-good-password');
}

describe('Setup — first run in the browser', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue(OVERVIEW);
    signIn.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts with what you’ll need, including where the setup code is', async () => {
    server();
    renderSetup();
    expect(await screen.findByText('What you’ll need')).toBeInTheDocument();
    expect(screen.getAllByText(/docker logs ktl/).length).toBeGreaterThan(0);
  });

  it('sets the server up in one step, signs you in, then asks who you share with', async () => {
    const user = userEvent.setup();
    const fetchMock = server();
    renderSetup();
    await fillClaim(user);
    await user.click(screen.getByRole('button', { name: 'Set up the server' }));

    const [, opts] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/setup/claim'));
    expect(JSON.parse(opts.body)).toMatchObject({ code: 'ABCD-EF23', household: 'Flat 4', name: 'Alex Rivera', email: 'alex@example.com' });
    expect(signIn).toHaveBeenCalledWith('alex@example.com', 'a-good-password');
    expect(await screen.findByText('Who you share with')).toBeInTheDocument();
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
  });

  it('shows the server’s reason when the code is wrong', async () => {
    const user = userEvent.setup();
    server({ claimStatus: 403, claim: { error: 'bad_code', message: 'That setup code isn’t right.' } });
    renderSetup();
    await fillClaim(user);
    await user.click(screen.getByRole('button', { name: 'Set up the server' }));

    expect(await screen.findByText('That setup code isn’t right.')).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('sends people to log in once the server is set up', async () => {
    server({ ready: true });
    renderSetup();
    expect(await screen.findByText('This server is set up')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in to KTL' })).toHaveAttribute('href', '/android/onboarding');
  });
});

describe('Setup — on a computer, the full guide', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue(OVERVIEW);
    signIn.mockClear();
    vi.stubGlobal('matchMedia', (query) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('scrollTo', () => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the guide with the real setup form in step 3, then carries on as a column', async () => {
    const user = userEvent.setup();
    const fetchMock = server();
    renderSetup();
    expect(await screen.findByRole('heading', { name: 'Run KTL on your own server.' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3 · at /setup')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Setup code'), 'ABCD-EF23');
    await user.type(screen.getByLabelText('Household name'), 'Flat 4');
    await user.type(screen.getByLabelText('Your name'), 'Alex Rivera');
    await user.type(screen.getByLabelText('Your email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-good-password');
    await user.click(screen.getByRole('button', { name: 'Set up the server' }));

    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/setup/claim'))).toBe(true);
    expect(await screen.findByText('Who you share with')).toBeInTheDocument();
  });

  it('runs the real app in all three device frames, on the screen you pick', async () => {
    const user = userEvent.setup();
    server();
    renderSetup();
    await screen.findByRole('heading', { name: 'Run KTL on your own server.' });
    const frames = () => ['KTL on an Android phone', 'KTL on an Android tablet', 'KTL in a desktop browser'].map((t) => screen.getByTitle(t));
    frames().forEach((f) => expect(f).toHaveAttribute('src', '/android/home'));

    await user.click(screen.getByRole('tab', { name: 'Balance' }));
    frames().forEach((f) => expect(f).toHaveAttribute('src', '/android/settle'));
  });

  it('points to logging in and the admin page once the server is set up', async () => {
    server({ ready: true });
    renderSetup();
    expect(await screen.findByText('This server is set up')).toBeInTheDocument();
    expect(screen.queryByLabelText('Setup code')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Log in to KTL' })[0]).toHaveAttribute('href', '/android/onboarding');
  });
});
