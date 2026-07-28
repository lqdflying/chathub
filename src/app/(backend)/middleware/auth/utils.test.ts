import { type AuthObject } from '@clerk/backend';
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
        clerkAuth: { userId: 'someUserId' } as AuthObject,
      }),
    ).toBe('clerk');
  });

  it('should throw error with invalid Clerk auth', () => {
    enableClerkMock = true;
    try {
      checkAuthMethod({
        clerkAuth: {} as any,
      });
    } catch (e) {
      expect(e).toEqual({ errorType: 'InvalidClerkUser' });
    }
  });

  it('should pass with valid Next auth', () => {
    enableNextAuthMock = true;
    expect(
      checkAuthMethod({
        nextAuthAuthorized: true,
      }),
    ).toBe('nextAuth');
  });

  it('should prefer valid Next auth over token auth', () => {
    enableNextAuthMock = true;
    enableTokenAuthMock = true;

    expect(
      checkAuthMethod({
        nextAuthAuthorized: true,
        tokenAuthAuthorized: true,
      }),
    ).toBe('nextAuth');
  });

  it('should select valid token auth', () => {
    enableTokenAuthMock = true;

    expect(
      checkAuthMethod({
        tokenAuthAuthorized: true,
      }),
    ).toBe('tokenAuth');
  });

  it('should pass with valid API key', () => {
    expect(
      checkAuthMethod({
        apiKey: 'someApiKey',
      }),
    ).toBe('apiKey');
  });

  it('should pass with no access code required', () => {
    vi.mocked(getAppConfig).mockReturnValueOnce({
      ACCESS_CODES: [],
    } as any);

    expect(checkAuthMethod({})).toBe('none');
  });

  it('should pass with valid access code', () => {
    expect(
      checkAuthMethod({
        accessCode: 'validAccessCode',
      }),
    ).toBe('accessCode');
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
