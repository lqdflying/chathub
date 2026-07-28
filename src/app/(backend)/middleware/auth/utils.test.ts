import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAppConfig } from '@/envs/app';

import { checkAuthMethod } from './utils';

let enableClerkMock = false;
let enableNextAuthMock = false;
let enableTokenAuthMock = false;

vi.mock('@/const/auth', async (importOriginal) => {
  const data = await importOriginal();

  return {
    ...(data as any),
    get enableClerk() {
      return enableClerkMock;
    },
    get enableNextAuth() {
      return enableNextAuthMock;
    },
    get enableTokenAuth() {
      return enableTokenAuthMock;
    },
  };
});

vi.mock('@/envs/app', () => ({
  getAppConfig: vi.fn(),
}));

describe('checkAuthMethod', () => {
  beforeEach(() => {
    enableClerkMock = false;
    enableNextAuthMock = false;
    enableTokenAuthMock = false;
    vi.mocked(getAppConfig).mockReturnValue({
      ACCESS_CODES: ['validAccessCode'],
    } as any);
  });

  it('should pass with valid Clerk auth', () => {
    enableClerkMock = true;
    expect(
      checkAuthMethod({
        clerkUserId: 'someUserId',
      }),
    ).toEqual({ method: 'clerk', userId: 'someUserId' });
  });

  it('should fail closed with invalid Clerk auth', () => {
    enableClerkMock = true;
    expect(() =>
      checkAuthMethod({
        apiKey: 'payload-key',
        clerkUserId: null,
      }),
    ).toThrow();
  });

  it('should pass with valid Next auth', () => {
    enableNextAuthMock = true;
    expect(
      checkAuthMethod({
        nextAuthUserId: 'session-user',
      }),
    ).toEqual({ method: 'nextAuth', userId: 'session-user' });
  });

  it('should prefer valid Next auth over token auth', () => {
    enableNextAuthMock = true;
    enableTokenAuthMock = true;

    expect(
      checkAuthMethod({
        nextAuthUserId: 'session-user',
        tokenAuthUserId: 'token-user',
      }),
    ).toEqual({ method: 'nextAuth', userId: 'session-user' });
  });

  it('should select valid token auth', () => {
    enableTokenAuthMock = true;

    expect(
      checkAuthMethod({
        tokenAuthUserId: 'token-user',
      }),
    ).toEqual({ method: 'tokenAuth', userId: 'token-user' });
  });

  it('should accept a valid token when the configured NextAuth session is missing', () => {
    enableNextAuthMock = true;
    enableTokenAuthMock = true;

    expect(
      checkAuthMethod({
        nextAuthUserId: null,
        tokenAuthUserId: 'token-user',
      }),
    ).toEqual({ method: 'tokenAuth', userId: 'token-user' });
  });

  it('should reject payload credentials when configured authentication does not validate', () => {
    enableNextAuthMock = true;
    enableTokenAuthMock = true;

    expect(() =>
      checkAuthMethod({
        accessCode: 'validAccessCode',
        apiKey: 'payload-key',
        nextAuthUserId: null,
      }),
    ).toThrow();
  });

  it('should pass with valid API key', () => {
    expect(
      checkAuthMethod({
        apiKey: 'someApiKey',
      }),
    ).toEqual({ method: 'apiKey' });
  });

  it('should pass with no access code required', () => {
    vi.mocked(getAppConfig).mockReturnValueOnce({
      ACCESS_CODES: [],
    } as any);

    expect(checkAuthMethod({})).toEqual({ method: 'none' });
  });

  it('should pass with valid access code', () => {
    expect(
      checkAuthMethod({
        accessCode: 'validAccessCode',
      }),
    ).toEqual({ method: 'accessCode' });
  });

  it('should throw error with invalid access code', () => {
    try {
      checkAuthMethod({
        accessCode: 'invalidAccessCode',
      });
    } catch (e) {
      expect(e).toEqual({
        errorType: 'InvalidAccessCode',
      });
    }

    try {
      checkAuthMethod({});
    } catch (e) {
      expect(e).toEqual({
        errorType: 'InvalidAccessCode',
      });
    }
  });
});
