import { ChatErrorType } from '@lobechat/types';
import { getXorPayload } from '@lobechat/utils/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOBE_CHAT_AUTH_HEADER, LOBE_CHAT_OIDC_AUTH_HEADER, OAUTH_AUTHORIZED } from '@/const/auth';
import { getAppConfig } from '@/envs/app';
import { validateOIDCJWT } from '@/libs/oidc-provider/jwt';

import { checkAuthMethod, resolveWebApiAuthFromHeader } from './utils';

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

vi.mock('@lobechat/utils/server', () => ({
  getXorPayload: vi.fn(),
}));

vi.mock('@/libs/oidc-provider/jwt', () => ({
  validateOIDCJWT: vi.fn(),
}));

describe('checkAuthMethod', () => {
  beforeEach(() => {
    enableClerkMock = false;
    enableNextAuthMock = false;
    enableTokenAuthMock = false;
    vi.clearAllMocks();
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

describe('resolveWebApiAuthFromHeader', () => {
  beforeEach(() => {
    enableClerkMock = false;
    enableNextAuthMock = false;
    enableTokenAuthMock = false;
    vi.clearAllMocks();
    vi.mocked(getAppConfig).mockReturnValue({
      ACCESS_CODES: ['validAccessCode'],
    } as any);
  });

  it('decodes the standard encrypted payload before resolving access-code auth', async () => {
    vi.mocked(getXorPayload).mockReturnValue({
      accessCode: 'validAccessCode',
      baseURL: 'https://openai.example/v1',
    });
    const request = new Request('https://chathub.example/webapi/proxy', {
      headers: { [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload' },
      method: 'POST',
    });

    await expect(resolveWebApiAuthFromHeader(request)).resolves.toEqual({
      authResult: { method: 'accessCode' },
      payload: {
        accessCode: 'validAccessCode',
        baseURL: 'https://openai.example/v1',
      },
    });
    expect(getXorPayload).toHaveBeenCalledWith('encrypted-payload');
  });

  it('supports no-auth local mode without attempting to decode a missing header', async () => {
    vi.mocked(getAppConfig).mockReturnValue({ ACCESS_CODES: [] } as any);
    const request = new Request('https://chathub.example/webapi/proxy', {
      method: 'POST',
    });

    await expect(resolveWebApiAuthFromHeader(request)).resolves.toEqual({
      authResult: { method: 'none' },
      payload: {},
    });
    expect(getXorPayload).not.toHaveBeenCalled();
  });

  it('does not use provider API keys to authorize operational routes by default', async () => {
    vi.mocked(getXorPayload).mockReturnValue({
      apiKey: 'client-provider-key',
    });
    const request = new Request('https://chathub.example/webapi/proxy', {
      headers: { [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload' },
      method: 'POST',
    });

    await expect(resolveWebApiAuthFromHeader(request)).rejects.toMatchObject({
      errorType: ChatErrorType.InvalidAccessCode,
    });
  });

  it('allows provider API-key auth only for routes that explicitly opt in', async () => {
    vi.mocked(getXorPayload).mockReturnValue({
      apiKey: 'client-provider-key',
    });
    const request = new Request('https://chathub.example/webapi/tts/openai', {
      headers: { [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload' },
      method: 'POST',
    });

    await expect(
      resolveWebApiAuthFromHeader(request, { allowProviderApiKey: true }),
    ).resolves.toEqual({
      authResult: { method: 'apiKey' },
      payload: { apiKey: 'client-provider-key' },
    });
  });

  it('binds a validated OIDC client to its token subject', async () => {
    vi.mocked(getXorPayload).mockReturnValue({
      accessCode: 'validAccessCode',
      userId: 'caller-selected-owner',
    });
    vi.mocked(validateOIDCJWT).mockResolvedValue({
      tokenData: {},
      userId: 'oidc-owner',
    } as never);
    const request = new Request('https://chathub.example/webapi/proxy', {
      headers: {
        [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload',
        [LOBE_CHAT_OIDC_AUTH_HEADER]: 'valid-oidc-token',
      },
      method: 'POST',
    });

    await expect(resolveWebApiAuthFromHeader(request)).resolves.toEqual({
      authResult: { method: 'oidc', userId: 'oidc-owner' },
      payload: {
        accessCode: 'validAccessCode',
        userId: 'caller-selected-owner',
      },
    });
    expect(validateOIDCJWT).toHaveBeenCalledWith('valid-oidc-token');
  });

  it('rejects an invalid supplied OIDC token without falling back to payload credentials', async () => {
    vi.mocked(getXorPayload).mockReturnValue({
      accessCode: 'validAccessCode',
    });
    vi.mocked(validateOIDCJWT).mockRejectedValue(new Error('invalid OIDC token'));
    const request = new Request('https://chathub.example/webapi/proxy', {
      headers: {
        [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload',
        [LOBE_CHAT_OIDC_AUTH_HEADER]: 'invalid-oidc-token',
      },
      method: 'POST',
    });

    await expect(resolveWebApiAuthFromHeader(request)).rejects.toThrow('invalid OIDC token');
    expect(validateOIDCJWT).toHaveBeenCalledWith('invalid-oidc-token');
  });

  it('rejects a forged OAuth marker when configured bearer auth does not validate', async () => {
    enableTokenAuthMock = true;
    vi.mocked(getAppConfig).mockReturnValue({ ACCESS_CODES: [] } as any);
    const request = new Request('https://chathub.example/webapi/tts/openai', {
      headers: { [OAUTH_AUTHORIZED]: 'true' },
      method: 'POST',
    });

    await expect(
      resolveWebApiAuthFromHeader(request, { allowProviderApiKey: true }),
    ).rejects.toMatchObject({
      errorType: ChatErrorType.Unauthorized,
    });
    expect(getXorPayload).not.toHaveBeenCalled();
  });
});
