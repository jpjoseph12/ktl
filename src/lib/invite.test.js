import { afterEach, describe, expect, it } from 'vitest';
import { appInviteLink, clearPendingInvite, inviteDone, parseInvite, readPendingInvite, sameServer, savePendingInvite, tokenFromHash } from './invite';

const TOKEN = 'Ab3_-'.repeat(9);

describe('invites', () => {
  afterEach(() => localStorage.clear());

  it('finds the server and token in a web link, an app link, or a whole message', () => {
    expect(parseInvite(`https://ktl.example.com/join#${TOKEN}`)).toEqual({ server: 'https://ktl.example.com', token: TOKEN });
    expect(parseInvite(appInviteLink('http://192.168.1.20:8095', TOKEN))).toEqual({ server: 'http://192.168.1.20:8095', token: TOKEN });
    expect(parseInvite(`Alex has invited you to Flat 4 on KTL…\n\nOpen this link — it works once, until 14:00:\nhttps://ktl.example.com/join#${TOKEN}`))
      .toEqual({ server: 'https://ktl.example.com', token: TOKEN });
  });

  it('ignores anything that isn’t an invite', () => {
    expect(parseInvite('ktl.example.com')).toBeNull();
    expect(parseInvite('https://ktl.example.com/join#short')).toBeNull();
    expect(parseInvite('ktl://join?server=ftp%3A%2F%2Fx#' + TOKEN)).toBeNull();
  });

  it('reads the token from a /join page’s address', () => {
    expect(tokenFromHash(`#${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash('')).toBe('');
  });

  it('keeps a pending invite until it’s used, and doesn’t bring a used one back', () => {
    savePendingInvite({ server: 'https://ktl.example.com', token: TOKEN });
    expect(readPendingInvite()).toEqual({ server: 'https://ktl.example.com', token: TOKEN });
    expect(inviteDone(TOKEN)).toBe(false);
    clearPendingInvite();
    expect(readPendingInvite()).toBeNull();
    expect(inviteDone(TOKEN)).toBe(true);
  });

  it('compares servers however their address was typed', () => {
    expect(sameServer('https://ktl.example.com/', 'ktl.example.com')).toBe(true);
    expect(sameServer('https://ktl.example.com', 'https://other.example.com')).toBe(false);
    expect(sameServer('', 'https://ktl.example.com')).toBe(false);
  });
});

describe('connect links (the /get page’s “Open in the KTL app”)', () => {
  it('round-trips a server through ktl://connect', async () => {
    const { appConnectLink, parseConnect } = await import('./invite');
    expect(parseConnect(appConnectLink('https://ktl.example.com'))).toEqual({ server: 'https://ktl.example.com' });
    expect(parseConnect('ktl://connect?server=http%3A%2F%2F192.168.1.20%3A8095')).toEqual({ server: 'http://192.168.1.20:8095' });
  });

  it('ignores anything else', async () => {
    const { parseConnect } = await import('./invite');
    expect(parseConnect('ktl://join?server=https%3A%2F%2Fx#tok')).toBeNull();
    expect(parseConnect('ktl://connect?server=ftp%3A%2F%2Fx')).toBeNull();
    expect(parseConnect(undefined)).toBeNull();
  });
});
