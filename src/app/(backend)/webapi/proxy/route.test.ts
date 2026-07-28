// @vitest-environment node
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { ssrfSafeFetch } from 'ssrf-safe-fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWebApiAuthFromHeader } from '@/app/(backend)/middleware/auth/utils';

import { POST } from './route';

vi.mock('ssrf-safe-fetch', () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock('@/app/(backend)/middleware/auth/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/(backend)/middleware/auth/utils')>()),
  resolveWebApiAuthFromHeader: vi.fn(),
}));

describe('POST /webapi/proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests before reading or fetching the target URL', async () => {
    const readTargetUrl = vi.fn();
    vi.mocked(resolveWebApiAuthFromHeader).mockRejectedValue(
      AgentRuntimeError.createError(ChatErrorType.Unauthorized),
    );
    const request = {
      headers: new Headers(),
      text: readTargetUrl,
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(readTargetUrl).not.toHaveBeenCalled();
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it('retains SSRF-safe fetching after authentication succeeds', async () => {
    vi.mocked(resolveWebApiAuthFromHeader).mockResolvedValue({
      authResult: { method: 'nextAuth', userId: 'account-a' },
      payload: {},
    });
    vi.mocked(ssrfSafeFetch).mockResolvedValue(
      new Response('image-data', {
        headers: { 'content-type': 'image/png' },
      }),
    );
    const request = new Request('https://chathub.example/webapi/proxy', {
      body: 'https://images.example/image.png',
      method: 'POST',
    });

    const response = await POST(request);

    expect(ssrfSafeFetch).toHaveBeenCalledWith('https://images.example/image.png');
    await expect(response.text()).resolves.toBe('image-data');
  });
});
