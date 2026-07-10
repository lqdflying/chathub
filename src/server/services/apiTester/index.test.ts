import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ssrfSafeFetch } from 'ssrf-safe-fetch';

import { executeApiTesterRequest } from './index';

vi.mock('ssrf-safe-fetch', () => ({
  ssrfSafeFetch: vi.fn(),
}));

describe('executeApiTesterRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards GET requests with bearer headers through ssrfSafeFetch', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' },
        status: 200,
        statusText: 'OK',
      }),
    );

    const response = await executeApiTesterRequest({
      headers: { Authorization: 'Bearer token123' },
      method: 'GET',
      url: 'https://api.example.com/users',
    });

    expect(ssrfSafeFetch).toHaveBeenCalledWith('https://api.example.com/users', {
      body: undefined,
      headers: { Authorization: 'Bearer token123' },
      method: 'GET',
    });
    expect(response).toEqual({
      body: '{"ok":true}',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-1',
      },
      status: 200,
      statusText: 'OK',
    });
  });

  it('does not send body for GET requests', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(new Response('', { status: 204 }));

    await executeApiTesterRequest({
      body: '{"ignored":true}',
      headers: { 'Content-Type': 'application/json' },
      method: 'GET',
      url: 'https://api.example.com/users',
    });

    expect(ssrfSafeFetch).toHaveBeenCalledWith('https://api.example.com/users', {
      body: undefined,
      headers: { 'Content-Type': 'application/json' },
      method: 'GET',
    });
  });

  it('passes an abort signal to ssrfSafeFetch when provided', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(new Response('', { status: 204 }));
    const controller = new AbortController();

    await executeApiTesterRequest(
      {
        method: 'DELETE',
        url: 'https://api.example.com/users/1',
      },
      { signal: controller.signal },
    );

    expect(ssrfSafeFetch).toHaveBeenCalledWith('https://api.example.com/users/1', {
      body: undefined,
      headers: undefined,
      method: 'DELETE',
      signal: controller.signal,
    });
  });

  it('sends body for DELETE requests', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(new Response('', { status: 204 }));

    await executeApiTesterRequest({
      body: '{"reason":"duplicate"}',
      headers: { 'Content-Type': 'application/json' },
      method: 'DELETE',
      url: 'https://api.example.com/users/1',
    });

    expect(ssrfSafeFetch).toHaveBeenCalledWith('https://api.example.com/users/1', {
      body: '{"reason":"duplicate"}',
      headers: { 'Content-Type': 'application/json' },
      method: 'DELETE',
    });
  });

  it('rejects non-http urls', async () => {
    await expect(
      executeApiTesterRequest({
        method: 'GET',
        url: 'ftp://api.example.com/users',
      }),
    ).rejects.toThrow('Only http:// and https:// URLs are supported');

    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it('surfaces ssrfSafeFetch rejection for private hosts', async () => {
    vi.mocked(ssrfSafeFetch).mockRejectedValueOnce(new Error('private IP address is not allowed'));

    await expect(
      executeApiTesterRequest({
        method: 'GET',
        url: 'https://127.0.0.1.nip.io/users',
      }),
    ).rejects.toThrow('private IP address is not allowed');
  });
});
