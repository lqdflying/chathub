import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  registerClient,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverOAuthMetadata } from './oauthDiscovery';

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  discoverAuthorizationServerMetadata: vi.fn(),
  discoverOAuthProtectedResourceMetadata: vi.fn(),
  registerClient: vi.fn(),
}));

describe('discoverOAuthMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the same validating fetch through discovery and registration', async () => {
    vi.mocked(discoverOAuthProtectedResourceMetadata).mockImplementation(
      async (_serverUrl, _options, fetchFn) => {
        await fetchFn('https://mcp.example.com/.well-known/oauth-protected-resource');

        return {
          authorization_servers: [new URL('https://auth.example.com')],
          scopes_supported: ['search'],
        } as any;
      },
    );
    vi.mocked(discoverAuthorizationServerMetadata).mockImplementation(
      async (_authorizationServerUrl, options) => {
        await options.fetchFn('https://auth.example.com/.well-known/oauth-authorization-server');

        return {
          authorization_endpoint: new URL('https://auth.example.com/authorize'),
          registration_endpoint: new URL('https://auth.example.com/register'),
          token_endpoint: new URL('https://auth.example.com/token'),
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        } as any;
      },
    );
    vi.mocked(registerClient).mockImplementation(async (_authorizationServerUrl, options) => {
      await options.fetchFn('https://auth.example.com/register', { method: 'POST' });

      return {
        client_id: 'registered-client-id',
        client_secret: 'registered-client-secret',
      } as any;
    });
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const metadata = await discoverOAuthMetadata(
      'https://mcp.example.com/mcp',
      'ChatHub',
      'https://chat.example.com/oauth/mcp-callback',
      fetchFn as typeof fetch,
    );

    expect(metadata).toMatchObject({
      authorizationEndpoint: 'https://auth.example.com/authorize',
      clientId: 'registered-client-id',
      clientSecret: 'registered-client-secret',
      scopesSupported: ['search'],
      tokenEndpoint: 'https://auth.example.com/token',
      tokenEndpointAuthMethodsSupported: ['client_secret_basic'],
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(discoverOAuthProtectedResourceMetadata).toHaveBeenCalledWith(
      'https://mcp.example.com/mcp',
      {},
      expect.any(Function),
    );
    expect(discoverAuthorizationServerMetadata).toHaveBeenCalledWith('https://auth.example.com/', {
      fetchFn: expect.any(Function),
    });
    expect(registerClient).toHaveBeenCalledWith(
      'https://auth.example.com/',
      expect.objectContaining({
        fetchFn: expect.any(Function),
      }),
    );
  });

  it('sanitizes HTML returned through SDK discovery fetches', async () => {
    vi.mocked(discoverOAuthProtectedResourceMetadata).mockImplementation(
      async (_serverUrl, _options, fetchFn) => {
        await fetchFn('https://mcp.example.com/.well-known/oauth-protected-resource?secret=value');

        return undefined;
      },
    );
    vi.mocked(discoverAuthorizationServerMetadata).mockImplementation(
      async (_authorizationServerUrl, options) => {
        await options.fetchFn('https://mcp.example.com/.well-known/oauth-authorization-server');

        return undefined as any;
      },
    );
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('<!DOCTYPE html><html>hidden secret body</html>', {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const error = await discoverOAuthMetadata(
      'https://mcp.example.com/mcp?api_key=configured-url-secret',
      'ChatHub',
      'https://chat.example.com/oauth/mcp-callback',
      fetchFn as typeof fetch,
    ).catch((caughtError: unknown) => caughtError);
    const serializedError = JSON.stringify(error);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('OAuth metadata discovery failed');
    expect(serializedError).not.toContain('<!DOCTYPE');
    expect(serializedError).not.toContain('hidden secret body');
    expect(serializedError).not.toContain('secret=value');
    expect(serializedError).not.toContain('configured-url-secret');
    expect(serializedError).not.toContain('Unexpected token');
  });
});
