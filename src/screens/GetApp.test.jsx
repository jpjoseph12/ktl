import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GetApp from './GetApp';
import QrCode from '../components/QrCode';

vi.mock('../context/KettleContext', () => ({ useKettle: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal()), SERVER_URL: 'https://ktl.example.com', IS_NATIVE: false }));

const ua = (value) => Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true });

describe('GetApp — where the admin page’s QR code leads', () => {
  afterEach(() => ua('Mozilla/5.0 (jsdom)'));

  it('on an Android phone, opens the app on this server, or gets it', () => {
    ua('Mozilla/5.0 (Linux; Android 16; SM-S928B) Chrome/140');
    render(<MemoryRouter><GetApp /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /open in the ktl app/i })).toHaveAttribute('href', 'ktl://connect?server=https%3A%2F%2Fktl.example.com');
    expect(screen.getByRole('link', { name: 'Get the Android app' })).toHaveAttribute('href', 'https://github.com/jpjoseph12/ktl/releases/latest');
    expect(screen.getByRole('link', { name: 'Use KTL in this browser' })).toHaveAttribute('href', '/android/onboarding');
  });

  it('elsewhere, says which address to type into the app', () => {
    render(<MemoryRouter><GetApp /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /open in the ktl app/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('https://ktl.example.com').length).toBeGreaterThan(0);
  });
});

describe('QrCode', () => {
  it('draws a labelled code for the text', () => {
    render(<QrCode text="https://ktl.example.com/get" label="QR code: get KTL" />);
    const svg = screen.getByRole('img', { name: 'QR code: get KTL' });
    expect(svg.querySelector('path').getAttribute('d').length).toBeGreaterThan(100);
  });
});
