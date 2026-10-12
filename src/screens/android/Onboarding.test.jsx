import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidOnboarding, { SetPasswordScreen } from './Onboarding';
import { useAuth } from '../../context/AuthContext';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/KettleContext', () => ({ useKettle: vi.fn() }));

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
  beforeEach(() => { useAuth.mockReset(); });

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

  it('explains a wrong password, and offers a way in to people who only ever had email links', async () => {
    const user = userEvent.setup();
    const err = Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' });
    useAuth.mockReturnValue(auth({ signIn: vi.fn().mockRejectedValue(err) }));
    renderOnboarding();

    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await user.type(screen.getByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'not-it-at-all');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText(/that email and password don’t match/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set a password' })).toBeInTheDocument();
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
