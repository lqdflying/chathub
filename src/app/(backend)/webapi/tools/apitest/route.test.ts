// @vitest-environment node
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWebApiAuthFromHeader } from '@/app/(backend)/middleware/auth/utils';
import { executeApiTesterRequest } from '@/server/services/apiTester';

import { POST } from './route';

vi.mock('@/app/(backend)/middleware/auth/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/(backend)/middleware/auth/utils')>()),
  resolveWebApiAuthFromHeader: vi.fn(),
}));

vi.mock('@/server/services/apiTester', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/services/apiTester')>()),
  executeApiTesterRequest: vi.fn(),
}));

describe('POST /webapi/tools/apitest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests before parsing or executing the API request', async () => {
    const parseRequest = vi.fn();
    vi.mocked(resolveWebApiAuthFromHeader).mockRejectedValue(
      AgentRuntimeError.createError(ChatErrorType.Unauthorized),
    );
    const request = {
      headers: new Headers(),
      json: parseRequest,
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(parseRequest).not.toHaveBeenCalled();
    expect(executeApiTesterRequest).not.toHaveBeenCalled();
  });

  it('executes a validated request after authentication succeeds', async () => {
    vi.mocked(resolveWebApiAuthFromHeader).mockResolvedValue({
      authResult: { method: 'tokenAuth', userId: 'account-a' },
      payload: {},
    });
    vi.mocked(executeApiTesterRequest).mockResolvedValue({
      body: '{"ok":true}',
      headers: { 'content-type': 'application/json' },
      status: 200,
      statusText: 'OK',
    });
    const requestPayload = {
      method: 'GET',
      url: 'https://api.example/users',
    };
    const request = new Request('https://chathub.example/webapi/tools/apitest', {
      body: JSON.stringify(requestPayload),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    const response = await POST(request);

    expect(executeApiTesterRequest).toHaveBeenCalledWith(requestPayload, {
      signal: expect.any(AbortSignal),
    });
    await expect(response.json()).resolves.toEqual({
      body: '{"ok":true}',
      headers: { 'content-type': 'application/json' },
      status: 200,
      statusText: 'OK',
    });
  });
});
