import { describe, expect, it } from 'vitest';
import { parseBillAmount, validEmail, validName } from './validation';

describe('validEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(validEmail('jordan@example.com')).toBe(true);
    expect(validEmail('jordan.doyle+ktl@example.co.uk')).toBe(true);
    expect(validEmail('  jordan@example.com  ')).toBe(true); // trims surrounding whitespace
  });

  it('rejects malformed addresses', () => {
    expect(validEmail('')).toBe(false);
    expect(validEmail('jordan')).toBe(false);
    expect(validEmail('jordan@')).toBe(false);
    expect(validEmail('@example.com')).toBe(false);
    expect(validEmail('jordan@example')).toBe(false); // no TLD
    expect(validEmail('jordan example@example.com')).toBe(false); // internal space
    expect(validEmail('jordan@ example.com')).toBe(false);
    expect(validEmail('jordan@@example.com')).toBe(false);
  });
});

describe('validName', () => {
  it('accepts a real name', () => {
    expect(validName('Jordan Doyle')).toBe(true);
  });

  it('rejects empty or single-character input', () => {
    expect(validName('')).toBe(false);
    expect(validName(' ')).toBe(false);
    expect(validName('J')).toBe(false);
  });
});

describe('parseBillAmount', () => {
  it('reads pounds and pence, with or without a £', () => {
    expect(parseBillAmount('71.25')).toBe(71.25);
    expect(parseBillAmount(' £82.4 ')).toBe(82.4);
    expect(parseBillAmount('-12.50')).toBe(-12.5);
  });

  it('rejects zero, blanks and anything that isn’t money', () => {
    expect(parseBillAmount('0')).toBeNull();
    expect(parseBillAmount('')).toBeNull();
    expect(parseBillAmount('12.345')).toBeNull();
    expect(parseBillAmount('meter 4412')).toBeNull();
  });
});
