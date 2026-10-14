import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ServerSection from './ServerSection';
import { ScreenProvider } from '../context/ScreenContext';

const signOut = vi.fn().mockResolvedValue();
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ signOut }) }));
vi.mock('../lib/api', () => ({ SERVER_URL: 'https://ktl.example.com', IS_NATIVE: false, clearServer: vi.fn() }));

const renderSection = (props) => render(<MemoryRouter><ScreenProvider><ServerSection {...props} /></ScreenProvider></MemoryRouter>);

describe('ServerSection — which server this is', () => {
  it('shows the address to type into the app on another phone', () => {
    renderSection();
    expect(screen.getByText('https://ktl.example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy the address/i })).toBeInTheDocument();
  });

  it('takes the owner, and only the owner, to people and server settings inside the app', () => {
    const { unmount } = renderSection({ isOwner: true });
    const link = screen.getByRole('link', { name: /people and server settings/i });
    expect(link).toHaveAttribute('href', '/admin');
    expect(link).not.toHaveAttribute('target');
    unmount();
    renderSection({ isOwner: false });
    expect(screen.queryByRole('link', { name: /people and server settings/i })).not.toBeInTheDocument();
  });

  it('logs out', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(signOut).toHaveBeenCalled();
  });

  it('only offers a different server inside the app', () => {
    renderSection();
    expect(screen.queryByRole('button', { name: /different server/i })).not.toBeInTheDocument();
  });
});
