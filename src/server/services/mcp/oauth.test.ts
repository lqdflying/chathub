import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { McpOAuthService } from './oauth';

const createDatabaseMock = (tokenRecord?: Record<string, unknown>) => {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

  return {
    database: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(tokenRecord ? [tokenRecord] : []),
        }),
      }),
      update: vi.fn().mockReturnValue({ set: updateSet }),
    },
    updateSet,
    updateWhere,
  };
};

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('McpOAuthService token endpoint handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects malformed HTML from authorization-code exchange without exposing the body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('<!DOCTYPE html><html>authorization secret</html>', {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new McpOAuthService({} as any);

    const error = await (service as any)
      .exchangeCodeForTokens(
        'https://auth.example.com/token?client_secret=query-secret',
        'authorization-code',
        'code-verifier',
        'client-id',
        'https://chat.example.com/oauth/mcp-callback',
      )
      .catch((caughtError: unknown) => caughtError);

    expect(error.message).toContain('unexpected HTML document');
    expect(JSON.stringify(error)).not.toContain('<!DOCTYPE');
    expect(JSON.stringify(error)).not.toContain('authorization secret');
    expect(JSON.stringify(error)).not.toContain('query-secret');
    expect(JSON.stringify(error)).not.toContain('Unexpected token');
  });

  it('falls back from Basic authentication to client_secret_post once', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'replacement-token',
          expires_in: 3600,
          refresh_token: 'replacement-refresh-token',
          token_type: 'Bearer',
        }),
      );
    const service = new McpOAuthService({} as any);

    const tokenResponse = await (service as any).exchangeCodeForTokens(
      'https://auth.example.com/token',
      'authorization-code',
      'code-verifier',
      'client-id',
      'https://chat.example.com/oauth/mcp-callback',
      'client-secret',
      ['client_secret_basic'],
    );

    expect(tokenResponse.access_token).toBe('replacement-token');
    expect(fetch).toHaveBeenCalledTimes(2);

    const primaryRequest = vi.mocked(fetch).mock.calls[0][1];
    expect(new Headers(primaryRequest?.headers).get('authorization')).toMatch(/^Basic /);
    expect(new URLSearchParams(primaryRequest?.body as URLSearchParams).get('client_secret')).toBeNull();

    const fallbackRequest = vi.mocked(fetch).mock.calls[1][1];
    expect(new Headers(fallbackRequest?.headers).get('authorization')).toBeNull();
    expect(new Headers(fallbackRequest?.headers).get('content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(new URLSearchParams(fallbackRequest?.body as URLSearchParams)).toEqual(
      new URLSearchParams({
        client_id: 'client-id',
        client_secret: 'client-secret',
        code: 'authorization-code',
        code_verifier: 'code-verifier',
        grant_type: 'authorization_code',
        redirect_uri: 'https://chat.example.com/oauth/mcp-callback',
      }),
    );
  });

  it('falls back once during refresh and persists the replacement token', async () => {
    const tokenRecord = {
      accessToken: 'stale-token',
      clientId: 'client-id',
      expiresAt: new Date(Date.now() + 60_000),
      pluginIdentifier: 'tavily',
      refreshToken: 'refresh-token',
      scope: 'search',
      serverMetadata: {
        client_secret: 'client-secret',
        token_endpoint: 'https://auth.example.com/token',
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      },
      tokenType: 'Bearer',
      userId: 'user-id',
    };
    const { database, updateSet } = createDatabaseMock(tokenRecord);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'fresh-token',
          expires_in: 1800,
          refresh_token: 'fresh-refresh-token',
          scope: 'search extract',
          token_type: 'Bearer',
        }),
      );
    const service = new McpOAuthService(database as any);

    const token = await service.refreshOAuthToken('user-id', 'tavily');

    expect(token).toMatchObject({
      accessToken: 'fresh-token',
      refreshToken: 'fresh-refresh-token',
      scope: 'search extract',
      tokenType: 'Bearer',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'fresh-token',
        refreshToken: 'fresh-refresh-token',
        scope: 'search extract',
        tokenType: 'Bearer',
      }),
    );

    const fallbackRequest = vi.mocked(fetch).mock.calls[1][1];
    expect(new Headers(fallbackRequest?.headers).get('authorization')).toBeNull();
    expect(new URLSearchParams(fallbackRequest?.body as URLSearchParams)).toEqual(
      new URLSearchParams({
        client_id: 'client-id',
        client_secret: 'client-secret',
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token',
      }),
    );
  });

  it('does not persist malformed HTML returned during refresh', async () => {
    const tokenRecord = {
      accessToken: 'stale-token',
      clientId: 'client-id',
      refreshToken: 'refresh-token',
      serverMetadata: {
        token_endpoint: 'https://auth.example.com/token',
      },
      userId: 'user-id',
    };
    const { database, updateSet } = createDatabaseMock(tokenRecord);
    vi.mocked(fetch).mockResolvedValue(
      new Response('<html>refresh secret</html>', {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new McpOAuthService(database as any);

    await expect(service.refreshOAuthToken('user-id', 'tavily')).resolves.toBeNull();
    expect(updateSet).not.toHaveBeenCalled();
  });
});
