import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidOnboarding from '../android/Onboarding';
import LoadingScreen from '../../components/LoadingScreen';
import { useAuth } from '../../context/AuthContext';
import { CENTERED_QUERY } from '../../lib/useIsTablet';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
// Not used by sign-in, but TabletShell imports it, and the real one pulls in
// the API client.
vi.mock('../../context/KettleContext', () => ({ useKettle: vi.fn() }));

/* Only the centred-flow query matches: a portrait tablet, too narrow for
   the split-view screens but well past a phone. */
function portraitTablet() {
  window.matchMedia = (query) => ({
    matches: query === CENTERED_QUERY, media: query, addEventListener: () => {}, removeEventListener: () => {}
  });
}

describe('sign-in and loading on a tablet', () => {
  const realMatchMedia = window.matchMedia;

  beforeEach(() => {
    useAuth.mockReturnValue({ signIn: vi.fn().mockResolvedValue(undefined) });
    portraitTablet();
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
    vi.useRealTimers();
  });

  it('centres the welcome panel in the portrait tablet frame', () => {
    const { container } = render(<MemoryRouter><AndroidOnboarding /></MemoryRouter>);

    expect(container.querySelector('.tablet-shell.portrait .tablet-centered-col .splash-brand')).not.toBeNull();
    expect(container.querySelector('.phone-ui')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();
  });

  it('runs the same log-in flow in the centred column', async () => {
    const user = userEvent.setup();
    const signIn = vi.fn().mockResolvedValue(undefined);
    useAuth.mockReturnValue({ signIn });
    const { container } = render(<MemoryRouter><AndroidOnboarding /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await user.type(screen.getByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(signIn).toHaveBeenCalledWith('alex@example.com', 'correct horse');
    expect(container.querySelector('.tablet-centered-col #signin-password')).not.toBeNull();
  });

  it('paints the loading screen in the tablet frame, not the phone column', () => {
    vi.useFakeTimers();
    const { container } = render(<LoadingScreen label="Loading your household" />);
    act(() => { vi.advanceTimersByTime(300); });

    expect(container.querySelector('.tablet-shell.portrait > .tablet-frame > .boot')).not.toBeNull();
    expect(container.querySelector('.phone-ui')).toBeNull();
  });
});
