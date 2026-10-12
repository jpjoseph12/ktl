import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchServerInfo, normaliseServerUrl, resolveServerUrl } from './api';

describe('normaliseServerUrl', () => {
  it('turns whatever was typed into the server’s origin', () => {
    expect(normaliseServerUrl('ktl.example.com')).toBe('https://ktl.example.com');
    expect(normaliseServerUrl(' https://ktl.example.com/android/home ')).toBe('https://ktl.example.com');
    expect(normaliseServerUrl('http://192.168.1.20:8095')).toBe('http://192.168.1.20:8095');
  });

  it('rejects anything that isn’t a web address', () => {
    expect(normaliseServerUrl('')).toBe('');
    expect(normaliseServerUrl('ftp://ktl.example.com')).toBe('');
    expect(normaliseServerUrl('not a url at all')).toBe('');
  });
});

describe('resolveServerUrl', () => {
  it('uses the server that served the web app', () => {
    expect(resolveServerUrl({ native: false, stored: 'https://old.example', built: '', origin: 'https://ktl.example.com' }))
      .toBe('https://ktl.example.com');
  });

  it('lets the Android app’s saved choice win over a preconfigured build', () => {
    expect(resolveServerUrl({ native: true, stored: 'https://mine.example', built: 'https://built.example', origin: 'https://localhost' }))
      .toBe('https://mine.example');
    expect(resolveServerUrl({ native: true, stored: '', built: 'https://built.example', origin: 'https://localhost' }))
      .toBe('https://built.example');
  });

  it('never treats the Android WebView’s own origin as a server', () => {
    expect(resolveServerUrl({ native: true, stored: '', built: '', origin: 'https://localhost' })).toBe('');
  });
});

describe('fetchServerInfo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a KTL server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ app: 'ktl', ready: true }) })));
    await expect(fetchServerInfo('ktl.example.com')).resolves.toMatchObject({ app: 'ktl', url: 'https://ktl.example.com' });
  });

  it('says so when the address is something else', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ hello: 'world' }) })));
    await expect(fetchServerInfo('example.com')).rejects.toThrow(/isn’t a KTL server/);
  });

  it('says so when nothing answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchServerInfo('ktl.example.com')).rejects.toThrow(/Couldn’t reach/);
  });
});
