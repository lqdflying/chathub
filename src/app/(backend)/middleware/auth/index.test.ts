import { getAuth } from '@clerk/nextjs/server';
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { getXorPayload } from '@lobechat/utils/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOBE_CHAT_AUTH_HEADER, OAUTH_AUTHORIZED, TOKEN_AUTH_USER_HEADER } from '@/const/auth';
import { getAppConfig } from '@/envs/app';
import NextAuth from '@/libs/next-auth';
import { createErrorResponse } from '@/utils/errorResponse';

import { RequestHandler, checkAuth } from './index';

vi.mock('@clerk/nextjs/server', () => ({
  getAuth: vi.fn(),
}));

const authFlags = vi.hoisted(() => ({
  enableClerk: false,
  enableNextAuth: false,
  enableTokenAuth: false,
}));

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  get enableAuth() {
    return authFlags.enableClerk || authFlags.enableNextAuth || authFlags.enableTokenAuth;
  },
  get enableClerk() {
    return authFlags.enableClerk;
  },
  get enableNextAuth() {
    return authFlags.enableNextAuth;
  },
  get enableTokenAuth() {
    return authFlags.enableTokenAuth;
  },
}));

vi.mock('@/envs/app', () => ({
  getAppConfig: vi.fn(),
}));

vi.mock('@/libs/next-auth', () => ({
  default: {
    auth: vi.fn(),
  },
}));

vi.mock('@/utils/errorResponse', () => ({
  createErrorResponse: vi.fn(),
}));

vi.mock('@lobechat/utils/server', () => ({
  getXorPayload: vi.fn(),
}));

describe('checkAuth', () => {
  const mockHandler: RequestHandler = vi.fn();
  const mockRequest = new Request('https://example.com');
  const mockOptions = { params: Promise.resolve({ provider: 'mock' }) };

  beforeEach(() => {
    authFlags.enableClerk = false;
    authFlags.enableNextAuth = false;
    authFlags.enableTokenAuth = false;
    vi.clearAllMocks();
    vi.stubEnv('AUTH_TOKEN', 'access-token');
    vi.stubEnv('AUTH_USER_ID', 'account-a');
    vi.mocked(getAppConfig).mockReturnValue({ ACCESS_CODES: [] } as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it('should return unauthorized error if no authorization header', async () => {
    await checkAuth(mockHandler)(mockRequest, mockOptions);

    expect(createErrorResponse).toHaveBeenCalledWith(ChatErrorType.Unauthorized, {
      error: AgentRuntimeError.createError(ChatErrorType.Unauthorized),
      provider: 'mock',
    });
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('should return error response on getJWTPayload error', async () => {
    const mockError = AgentRuntimeError.createError(ChatErrorType.Unauthorized);
    mockRequest.headers.set('Authorization', 'invalid');
    vi.mocked(getXorPayload).mockRejectedValueOnce(mockError);

    await checkAuth(mockHandler)(mockRequest, mockOptions);

    expect(createErrorResponse).toHaveBeenCalledWith(ChatErrorType.Unauthorized, {
      error: mockError,
      provider: 'mock',
    });
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('rejects a request when configured token auth has no valid bearer', async () => {
    authFlags.enableTokenAuth = true;
    const request = new Request('https://example.com', {
      headers: {
        [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload',
      },
    });
    vi.mocked(getXorPayload).mockReturnValue({ userId: 'victim' });

    await checkAuth(mockHandler)(request, mockOptions);

    expect(createErrorResponse).toHaveBeenCalledWith(
      ChatErrorType.Unauthorized,
      expect.objectContaining({ provider: 'mock' }),
    );
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('does not authorize a forged token-auth user header', async () => {
    authFlags.enableTokenAuth = true;
    const request = new Request('https://example.com', {
      headers: {
        [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload',
        [TOKEN_AUTH_USER_HEADER]: 'victim',
      },
    });
    vi.mocked(getXorPayload).mockReturnValue({});

    await checkAuth(mockHandler)(request, mockOptions);

    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('binds a valid bearer request to the configured token-auth user', async () => {
    authFlags.enableTokenAuth = true;
    const request = new Request('https://example.com', {
      headers: {
        Authorization: 'Bearer access-token',
        [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload',
        [TOKEN_AUTH_USER_HEADER]: 'victim',
      },
    });
    vi.mocked(getXorPayload).mockReturnValue({ userId: 'victim' });

    await checkAuth(mockHandler)(request, mockOptions);

    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        jwtPayload: expect.objectContaining({
          userId: 'account-a',
        }),
      }),
    );
  });

  it('ignores a forged OAuth authorization header and binds the valid bearer owner', async () => {
    authFlags.enableNextAuth = true;
    authFlags.enableTokenAuth = true;
    vi.mocked(NextAuth.auth).mockResolvedValue(null);
    const request = new Request('https://example.com', {
      headers: {
        Authorization: 'Bearer access-token',
        [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload',
        [OAUTH_AUTHORIZED]: 'true',
      },
    });
    vi.mocked(getXorPayload).mockReturnValue({ userId: 'victim' });

    await checkAuth(mockHandler)(request, mockOptions);

    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        jwtPayload: expect.objectContaining({
          userId: 'account-a',
        }),
      }),
    );
  });

  it('binds a validated NextAuth session owner', async () => {
    authFlags.enableNextAuth = true;
    vi.mocked(NextAuth.auth).mockResolvedValue({
      expires: new Date(Date.now() + 60_000).toISOString(),
      user: { id: 'session-owner' },
    });
    const request = new Request('https://example.com', {
      headers: {
        [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload',
      },
    });
    vi.mocked(getXorPayload).mockReturnValue({ userId: 'victim' });

    await checkAuth(mockHandler)(request, mockOptions);

    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        jwtPayload: expect.objectContaining({
          userId: 'session-owner',
        }),
      }),
    );
  });

  it('binds the mapped Clerk database owner', async () => {
    authFlags.enableClerk = true;
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CLERK_DEV_IMPERSONATE_USER', 'dev-owner=database-owner');
    vi.mocked(getAuth).mockReturnValue({ userId: 'dev-owner' } as never);
    const request = new Request('https://example.com', {
      headers: {
        [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload',
      },
    });
    vi.mocked(getXorPayload).mockReturnValue({ userId: 'victim' });

    await checkAuth(mockHandler)(request, mockOptions);

    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        jwtPayload: expect.objectContaining({
          userId: 'database-owner',
        }),
      }),
    );
  });
});
