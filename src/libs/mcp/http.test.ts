import { describe, expect, it, vi } from 'vitest';

import {
  createMCPAuthenticatedFetch,
  createMCPValidatingFetch,
  sanitizeMCPURLForLogging,
  validateMCPHTTPResponse,
} from './http';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('sanitizeMCPURLForLogging', () => {
  it('preserves the origin and path while removing query parameters and fragments', () => {
    expect(
      sanitizeMCPURLForLogging(
        'https://mcp.example.com/tools/search?api_key=url-secret#private-fragment',
      ),
    ).toBe('https://mcp.example.com/tools/search');
  });

  it('does not echo malformed URL input', () => {
    expect(sanitizeMCPURLForLogging('url-secret')).toBe('[invalid MCP URL]');
  });

  it('keeps static discovery paths but fingerprints opaque path identifiers', () => {
    expect(
      sanitizeMCPURLForLogging(
        'https://mcp.example.com/.well-known/oauth-authorization-server',
      ),
    ).toBe('https://mcp.example.com/.well-known/oauth-authorization-server');

    const sanitized = sanitizeMCPURLForLogging(
      'https://mcp.example.com/users/123e4567-e89b-12d3-a456-426614174000/tools',
    );
    expect(sanitized).toMatch(/^https:\/\/mcp\.example\.com\/users\/h-[\da-f]{16}\/tools$/);
    expect(sanitized).not.toContain('123e4567');
  });
});

describe('validateMCPHTTPResponse', () => {
  it('preserves valid JSON responses', async () => {
    const response = jsonResponse({ jsonrpc: '2.0', result: {} });

    const validatedResponse = await validateMCPHTTPResponse(response);

    await expect(validatedResponse.json()).resolves.toEqual({ jsonrpc: '2.0', result: {} });
  });

  it('validates structured JSON media types', async () => {
    const response = new Response('{invalid-json', {
      headers: { 'content-type': 'application/problem+json; charset=utf-8' },
    });

    await expect(validateMCPHTTPResponse(response)).rejects.toMatchObject({
      data: { metadata: { step: 'http_response_validation' }, type: 'CONNECTION_FAILED' },
    });
  });

  it('does not consume event streams', async () => {
    const response = new Response('data: {"jsonrpc":"2.0"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });

    const validatedResponse = await validateMCPHTTPResponse(response);

    await expect(validatedResponse.text()).resolves.toBe('data: {"jsonrpc":"2.0"}\n\n');
  });

  it('returns a sanitized error when the response stream cannot be read', async () => {
    const response = jsonResponse({ ok: true });
    const responseClone = response.clone();
    vi.spyOn(responseClone, 'text').mockRejectedValue(
      new TypeError('terminated while reading private response bytes'),
    );
    vi.spyOn(response, 'clone').mockReturnValue(responseClone);

    const error = await validateMCPHTTPResponse(response).catch((caughtError) => caughtError);

    expect(error).toMatchObject({
      data: {
        metadata: { step: 'http_response_read' },
        type: 'CONNECTION_FAILED',
      },
    });
    expect(JSON.stringify(error)).not.toContain('private response bytes');
  });

  it.each([
    ['declared HTML', 'text/html', '<!DOCTYPE html><html>secret body</html>', 200],
    ['mislabeled HTML', 'application/json', '<!DOCTYPE html><html>secret body</html>', 200],
    ['unsuccessful HTML', 'text/html', '<!DOCTYPE html><html>secret body</html>', 502],
  ])('returns a sanitized error for %s', async (_, contentType, body, status) => {
    const response = new Response(body, {
      headers: { 'content-type': contentType },
      status,
    });

    const error = await validateMCPHTTPResponse(response).catch((caughtError) => caughtError);
    const serializedError = JSON.stringify(error);

    expect(error).toMatchObject({
      data: {
        metadata: { step: 'http_response_validation' },
        type: 'CONNECTION_FAILED',
      },
    });
    expect(error.message).toContain(`HTTP ${status}`);
    expect(error.message).toContain(`content-type ${contentType}`);
    expect(serializedError).not.toContain('<!DOCTYPE');
    expect(serializedError).not.toContain('secret body');
    expect(serializedError).not.toContain('Unexpected token');
  });

  it('strips bodies from unsuccessful responses', async () => {
    const response = new Response('token=secret-token', {
      headers: { 'content-type': 'application/json' },
      status: 502,
      statusText: 'Bad Gateway',
    });

    const validatedResponse = await validateMCPHTTPResponse(response);

    expect(validatedResponse.status).toBe(502);
    await expect(validatedResponse.text()).resolves.toBe('');
  });

  it('does not expose URL query secrets when validation fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('<html>proxy failure</html>', {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const validatingFetch = createMCPValidatingFetch(fetchFn);

    const error = await validatingFetch(
      'https://mcp.example.com/tools?api_key=url-secret',
    ).catch((caughtError) => caughtError);

    expect(JSON.stringify(error)).not.toContain('url-secret');
  });
});

describe('createMCPAuthenticatedFetch', () => {
  it('refreshes a stale token and retries the request once', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const tokenGetter = vi
      .fn()
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token');
    const authenticatedFetch = createMCPAuthenticatedFetch({ fetchFn, tokenGetter });

    const response = await authenticatedFetch('https://mcp.example.com/tools');

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(tokenGetter).toHaveBeenNthCalledWith(1);
    expect(tokenGetter).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(new Headers(fetchFn.mock.calls[0][1]?.headers).get('authorization')).toBe(
      'Bearer stale-token',
    );
    expect(new Headers(fetchFn.mock.calls[1][1]?.headers).get('authorization')).toBe(
      'Bearer fresh-token',
    );
  });

  it('stops after the retried request also returns 401', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const tokenGetter = vi
      .fn()
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token');
    const authenticatedFetch = createMCPAuthenticatedFetch({ fetchFn, tokenGetter });

    await expect(authenticatedFetch('https://mcp.example.com/tools')).rejects.toMatchObject({
      data: { type: 'AUTHORIZATION_ERROR' },
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(tokenGetter).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous forced token refreshes', async () => {
    let resolveRefresh: ((value: string) => void) | undefined;
    const refreshPromise = new Promise<string>((resolve) => {
      resolveRefresh = resolve;
    });
    const tokenGetter = vi
      .fn()
      .mockResolvedValueOnce('stale-token')
      .mockImplementation(({ forceRefresh } = {}) =>
        forceRefresh ? refreshPromise : Promise.resolve('stale-token'),
      );
    const fetchFn = vi.fn(async (_input, init) => {
      const authorization = new Headers(init?.headers).get('authorization');

      return authorization === 'Bearer stale-token'
        ? new Response(null, { status: 401 })
        : jsonResponse({ ok: true });
    });
    const authenticatedFetch = createMCPAuthenticatedFetch({ fetchFn, tokenGetter });

    const responsesPromise = Promise.all([
      authenticatedFetch('https://mcp.example.com/tools'),
      authenticatedFetch('https://mcp.example.com/resources'),
      authenticatedFetch('https://mcp.example.com/prompts'),
    ]);
    await vi.waitFor(() => {
      expect(tokenGetter).toHaveBeenCalledWith({ forceRefresh: true });
    });
    resolveRefresh?.('fresh-token');
    const responses = await responsesPromise;

    await expect(Promise.all(responses.map((response) => response.json()))).resolves.toEqual([
      { ok: true },
      { ok: true },
      { ok: true },
    ]);
    expect(tokenGetter.mock.calls.filter(([options]) => options?.forceRefresh)).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(6);
  });

  it('does not replay a rejected token when forced refresh fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const tokenGetter = vi
      .fn()
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce(undefined);
    const authenticatedFetch = createMCPAuthenticatedFetch({ fetchFn, tokenGetter });

    await expect(authenticatedFetch('https://mcp.example.com/tools')).rejects.toMatchObject({
      data: { type: 'AUTHORIZATION_ERROR' },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not refresh or retry non-OAuth 401 responses', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('private failure body', {
        headers: { 'content-type': 'application/json' },
        status: 401,
      }),
    );
    const authenticatedFetch = createMCPAuthenticatedFetch({ fetchFn });

    const response = await authenticatedFetch('https://mcp.example.com/tools');

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe('');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
