import { describe, expect, it } from 'vitest';
import { isRecoverableAuthError } from './authRetry';

/* Shared by both KettleContext's and PrivateContext's boot retries — kept
   as its own test because the cost of getting it wrong is asymmetric: too
   narrow and a transient blip strands someone on an error screen (or, for
   PrivateContext, silently shows empty defaults forever), too broad and a
   genuine failure gets retried three times before surfacing. */
describe('boot retry — which failures are worth a second go', () => {
  it('retries the clock-skew error that actually happened on device', () => {
    expect(isRecoverableAuthError({ message: 'JWT issued at future' })).toBe(true);
  });

  it('retries the ordinary expired-token cases', () => {
    expect(isRecoverableAuthError({ message: 'JWT expired' })).toBe(true);
    expect(isRecoverableAuthError({ message: 'Invalid refresh token' })).toBe(true);
    expect(isRecoverableAuthError({ message: 'token is expired' })).toBe(true);
  });

  it('does not retry a genuine data or permission failure', () => {
    // These will not fix themselves, so retrying just delays the truth.
    expect(isRecoverableAuthError({ message: 'permission denied for table bills' })).toBe(false);
    expect(isRecoverableAuthError({ message: 'duplicate key value violates unique constraint' })).toBe(false);
    expect(isRecoverableAuthError({ message: 'No household found for that code' })).toBe(false);
  });

  it('copes with an error that has no message at all', () => {
    expect(isRecoverableAuthError(undefined)).toBe(false);
    expect(isRecoverableAuthError({})).toBe(false);
  });
});
