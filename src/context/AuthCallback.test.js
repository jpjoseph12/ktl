import { describe, expect, it } from 'vitest';
import { codeFromCallback } from './AuthContext';

describe('ktl://auth/callback — what the app accepts from a link', () => {
  it('takes a one-time code and its flow id', () => {
    expect(codeFromCallback('ktl://auth/callback?code=abc123&sb_flow_id=f1')).toEqual({ code: 'abc123', flowId: 'f1' });
    expect(codeFromCallback('ktl://auth/callback?code=abc123')).toEqual({ code: 'abc123', flowId: undefined });
  });

  it('never takes a session handed over in the link itself', () => {
    expect(codeFromCallback('ktl://auth/callback#access_token=a&refresh_token=b&type=recovery')).toBeNull();
  });

  it('ignores other links', () => {
    expect(codeFromCallback('ktl://join?server=https%3A%2F%2Fx#tok')).toBeNull();
    expect(codeFromCallback('https://evil.example/auth/callback?code=abc')).toBeNull();
    expect(codeFromCallback(undefined)).toBeNull();
  });
});
