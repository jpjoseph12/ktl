import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidOnboarding, { SetPasswordScreen } from './Onboarding';
import { useAuth } from '../../context/AuthContext';
import { accountNeedsPassword } from '../../lib/api';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/KettleContext', () => ({ useKettle: vi.fn() }));
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal()), accountNeedsPassword: vi.fn() }));

function auth(overrides = {}) {
  return {
    signUp: vi.fn().mockResolvedValue({ needsConfirmation: false }),
    signIn: vi.fn().mockResolvedValue(undefined),
    requestPasswordReset: vi.fn().mockResolvedValue(undefined),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    finishRecovery: vi.fn(),
    serverSendsEmail: vi.fn().mockResolvedValue(true),
    ...overrides
  };
}

function renderOnboarding() {
  return render(<MemoryRouter><AndroidOnboarding /></MemoryRouter>);
}

async function fillSignup(user, password) {
  await user.click(screen.getByRole('button', { name: 'Sign up' }));
  await user.type(screen.getByLabelText('Full name'), 'Jordan Doyle');
  await user.type(screen.getByLabelText('Email address'), 'jordan@example.com');
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('Onboarding — email and password', () => {
  beforeEach(() => {
    useAuth.mockReset();
    accountNeedsPassword.mockReset();
    accountNeedsPassword.mockResolvedValue(false);
  });

  const wrongPassword = () => Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' });
  async function logIn(user) {
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await user.type(screen.getByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'not-it-at-all');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
  }

  it('creates an account with a name, email and password', async () => {
    const user = userEvent.setup();
    const A = auth();
    useAuth.mockReturnValue(A);
    renderOnboarding();

    await fillSignup(user, 'kettle-on-2026');

    expect(A.signUp).toHaveBeenCalledWith('jordan@example.com', 'kettle-on-2026', 'Jordan Doyle');
  });

  it('won’t send a password that is too short', async () => {
    const user = userEvent.setup();
    const A = auth();
    useAuth.mockReturnValue(A);
    renderOnboarding();

    await fillSignup(user, 'short');

    expect(A.signUp).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Password').closest('.field')).toHaveClass('invalid');
  });

  it('says to check the inbox when the server wants the address confirmed', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue(auth({ signUp: vi.fn().mockResolvedValue({ needsConfirmation: true }) }));
    renderOnboarding();

    await fillSignup(user, 'kettle-on-2026');

    expect(await screen.findByText('Check your email')).toBeInTheDocument();
  });

  it('explains a wrong password', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue(auth({ signIn: vi.fn().mockRejectedValue(wrongPassword()) }));
    renderOnboarding();

    await logIn(user);

    expect(await screen.findByText(/that email and password don’t match/i)).toBeInTheDocument();
    expect(accountNeedsPassword).toHaveBeenCalledWith('alex@example.com');
  });

  it('says when the account has no password yet, and emails a link to set one', async () => {
    const user = userEvent.setup();
    accountNeedsPassword.mockResolvedValue(true);
    const A = auth({ signIn: vi.fn().mockRejectedValue(wrongPassword()) });
    useAuth.mockReturnValue(A);
    renderOnboarding();

    await logIn(user);

    expect(await screen.findByText(/there isn’t a password set for/i)).toBeInTheDocument();
    expect(screen.queryByText(/don’t match/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Email me a link to set it' }));
    expect(A.requestPasswordReset).toHaveBeenCalledWith('alex@example.com');
    expect(await screen.findByText(/Open it to choose your password/)).toBeInTheDocument();
  });

  it('sends people with no password to whoever runs the server when it can’t email', async () => {
    const user = userEvent.setup();
    accountNeedsPassword.mockResolvedValue(true);
    useAuth.mockReturnValue(auth({ signIn: vi.fn().mockRejectedValue(wrongPassword()), serverSendsEmail: vi.fn().mockResolvedValue(false) }));
    renderOnboarding();

    await logIn(user);

    expect(await screen.findByText(/there isn’t a password set for/i)).toBeInTheDocument();
    expect(screen.getByText(/ask whoever runs it for a set-password link/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email me a link to set it' })).not.toBeInTheDocument();
  });

  it('emails a reset link when the server can send email', async () => {
    const user = userEvent.setup();
    const A = auth();
    useAuth.mockReturnValue(A);
    renderOnboarding();

    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await user.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    await user.type(await screen.findByLabelText('Email'), 'alex@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a reset link' }));

    expect(A.requestPasswordReset).toHaveBeenCalledWith('alex@example.com');
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
  });

  it('points to whoever runs the server when it can’t send email', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue(auth({ serverSendsEmail: vi.fn().mockResolvedValue(false) }));
    renderOnboarding();

    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await user.click(screen.getByRole('button', { name: 'Forgot your password?' }));

    expect(await screen.findByText(/ask whoever runs it for a reset link/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email me a reset link' })).not.toBeInTheDocument();
  });
});

describe('SetPasswordScreen', () => {
  it('saves the new password after a reset link', async () => {
    const user = userEvent.setup();
    const A = auth();
    useAuth.mockReturnValue(A);
    render(<MemoryRouter><SetPasswordScreen /></MemoryRouter>);

    await user.type(screen.getByLabelText('New password'), 'a-brand-new-one');
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(A.updatePassword).toHaveBeenCalledWith('a-brand-new-one');
  });
});
