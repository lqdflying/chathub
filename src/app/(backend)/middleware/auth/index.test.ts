import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { getXorPayload } from '@lobechat/utils/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOBE_CHAT_AUTH_HEADER, TOKEN_AUTH_USER_HEADER } from '@/const/auth';
import { createErrorResponse } from '@/utils/errorResponse';

import { RequestHandler, checkAuth } from './index';
import { checkAuthMethod } from './utils';

vi.mock('@clerk/nextjs/server', () => ({
  getAuth: vi.fn(),
}));

vi.mock('@/utils/errorResponse', () => ({
  createErrorResponse: vi.fn(),
}));

vi.mock('./utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@lobechat/utils/server', () => ({
  getXorPayload: vi.fn(),
}));

describe('checkAuth', () => {
  const mockHandler: RequestHandler = vi.fn();
  const mockRequest = new Request('https://example.com');
  const mockOptions = { params: Promise.resolve({ provider: 'mock' }) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUTH_TOKEN', 'access-token');
    vi.stubEnv('AUTH_USER_ID', 'account-a');
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

  it('should return error response on checkAuthMethod error', async () => {
    const mockError = AgentRuntimeError.createError(ChatErrorType.Unauthorized);
    mockRequest.headers.set('Authorization', 'valid');
    vi.mocked(getXorPayload).mockResolvedValueOnce({});
    vi.mocked(checkAuthMethod).mockImplementationOnce(() => {
      throw mockError;
    });

    await checkAuth(mockHandler)(mockRequest, mockOptions);

    expect(createErrorResponse).toHaveBeenCalledWith(ChatErrorType.Unauthorized, {
      error: mockError,
      provider: 'mock',
    });
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('does not authorize a forged token-auth user header', async () => {
    const request = new Request('https://example.com', {
      headers: {
        [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload',
        [TOKEN_AUTH_USER_HEADER]: 'victim',
      },
    });
    vi.mocked(getXorPayload).mockReturnValue({});

    await checkAuth(mockHandler)(request, mockOptions);

    expect(checkAuthMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenAuthAuthorized: false,
      }),
    );
  });

  it('binds a valid bearer request to the configured token-auth user', async () => {
    const request = new Request('https://example.com', {
      headers: {
        Authorization: 'Bearer access-token',
        [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload',
        [TOKEN_AUTH_USER_HEADER]: 'victim',
      },
    });
    vi.mocked(getXorPayload).mockReturnValue({ userId: 'victim' });
    vi.mocked(checkAuthMethod).mockReturnValue('tokenAuth');

    await checkAuth(mockHandler)(request, mockOptions);

    expect(checkAuthMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenAuthAuthorized: true,
      }),
    );
    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        jwtPayload: expect.objectContaining({
          userId: 'account-a',
        }),
      }),
    );
  });
});
