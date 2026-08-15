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
    // the upstream content-type must survive so the caller can validate the MIME
    expect(response.headers.get('content-type')).toBe('image/png');
  });

  it('forwards a non-OK upstream status, body and headers (so the corrupt-image guard fires)', async () => {
    vi.mocked(resolveWebApiAuthFromHeader).mockResolvedValue({
      authResult: { method: 'nextAuth', userId: 'account-a' },
      payload: {},
    });
    vi.mocked(ssrfSafeFetch).mockResolvedValue(
      new Response('Not Found', {
        headers: { 'content-type': 'text/plain' },
        status: 404,
        statusText: 'Not Found',
      }),
    );
    const request = new Request('https://chathub.example/webapi/proxy', {
      body: 'https://images.example/missing.png',
      method: 'POST',
    });

    const response = await POST(request);

    // previously this returned 200 with dropped headers, so res.ok was true and
    // the error page was uploaded as an image
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('text/plain');
    await expect(response.text()).resolves.toBe('Not Found');
  });

  it('does not reflect upstream Set-Cookie / policy headers onto the ChatHub origin (finding A)', async () => {
    vi.mocked(resolveWebApiAuthFromHeader).mockResolvedValue({
      authResult: { method: 'nextAuth', userId: 'account-a' },
      payload: {},
    });
    vi.mocked(ssrfSafeFetch).mockResolvedValue(
      new Response('image-data', {
        headers: {
          'content-security-policy': "default-src 'none'",
          'content-type': 'image/png',
          'set-cookie': 'session=attacker; Path=/; HttpOnly',
        },
      }),
    );
    const request = new Request('https://chathub.example/webapi/proxy', {
      body: 'https://images.example/image.png',
      method: 'POST',
    });

    const response = await POST(request);

    // only the content-type is forwarded; untrusted headers are dropped
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('content-security-policy')).toBeNull();
    await expect(response.text()).resolves.toBe('image-data');
  });
});
