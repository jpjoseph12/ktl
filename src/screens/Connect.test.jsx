import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Connect from './Connect';

vi.mock('../context/KettleContext', () => ({ useKettle: vi.fn() }));

describe('Connect — telling the app which server to use', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('checks the address is a KTL server, remembers it and carries on', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ app: 'ktl', ready: true }) })));
    const onConnected = vi.fn();
    render(<Connect onConnected={onConnected} />);

    await user.type(screen.getByLabelText('Server address'), 'ktl.example.com');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://ktl.example.com' }));
    expect(localStorage.getItem('ktl.server')).toBe('https://ktl.example.com');
  });

  it('takes a pasted invite: connects to its server and keeps the invite for the join screen', async () => {
    const user = userEvent.setup();
    const token = 'Ab3_-'.repeat(9);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ app: 'ktl', ready: true }) })));
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, replace });
    render(<Connect onConnected={vi.fn()} />);

    await user.click(screen.getByLabelText('Server address'));
    await user.paste(`Alex has invited you to Flat 4 on KTL. https://ktl.example.com/join#${token}`);
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(localStorage.getItem('ktl.server')).toBe('https://ktl.example.com');
    expect(JSON.parse(localStorage.getItem('ktl.invite'))).toEqual({ server: 'https://ktl.example.com', token });
    expect(replace).toHaveBeenCalledWith('/join');
  });

  it('explains when the address isn’t a KTL server, and saves nothing', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const onConnected = vi.fn();
    render(<Connect onConnected={onConnected} />);

    await user.type(screen.getByLabelText('Server address'), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/isn’t a KTL server/)).toBeInTheDocument();
    expect(onConnected).not.toHaveBeenCalled();
    expect(localStorage.getItem('ktl.server')).toBeNull();
  });
});
