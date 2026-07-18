import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/const/version', () => ({
  isDesktop: false,
  isServerMode: true,
}));

vi.mock('@/libs/trpc/lambda/middleware/serverDatabase', () => ({
  serverDatabase: vi.fn(async ({ ctx, next }) => next({ ctx })),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation((_url, options) => options),
}));

let capturedTransport: any;
const sdkCallToolMock = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    callTool: sdkCallToolMock,
    connect: vi.fn().mockImplementation(async (transport) => {
      capturedTransport = transport;
    }),
  })),
}));

const getOAuthTokenMock = vi.fn();
const refreshOAuthTokenMock = vi.fn();

vi.mock('@/server/services/mcp/oauth', () => ({
  McpOAuthService: vi.fn().mockImplementation(() => {
    return {
      getOAuthToken: getOAuthTokenMock,
      refreshOAuthToken: refreshOAuthTokenMock,
    };
  }),
}));

const responseFromTransport = async (path: string, init?: RequestInit) => {
  const response = await capturedTransport.fetch(`https://mcp.tavily.com/mcp/${path}`, init);

  return response.json();
};

const createCallerContext = () =>
  ({
    serverDB: {},
    userId: 'user-id',
  }) as any;

const oauthParams = {
  auth: {
    type: 'oauth2' as const,
  },
  name: 'tavily',
  type: 'http' as const,
  url: 'https://mcp.tavily.com/mcp/?api_key=query-secret',
};

describe('mcpRouter OAuth public boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    capturedTransport = undefined;
    getOAuthTokenMock.mockResolvedValue({
      accessToken: 'stored-access-token',
      expiresAt: Date.now() + 60_000,
      refreshToken: 'refresh-token',
    });
    refreshOAuthTokenMock.mockResolvedValue({
      accessToken: 'refreshed-access-token',
      expiresAt: Date.now() + 60_000,
      refreshToken: 'refresh-token',
    });
    sdkCallToolMock.mockImplementation(async () => {
      const transportResult = await responseFromTransport('tools/call', {
        method: 'POST',
      });

      return {
        content: [{ text: JSON.stringify(transportResult), type: 'text' }],
        isError: false,
      };
    });
  });

  const loadRouterWithTransportFetch = async (transportFetch: typeof fetch) => {
    vi.doMock('@/server/services/mcp', async () => {
      const actual = await vi.importActual<typeof import('@/server/services/mcp')>(
        '@/server/services/mcp',
      );

      return {
        ...actual,
        mcpService: new actual.MCPService({ fetchFn: transportFetch }),
      };
    });

    return import('./mcp');
  };

  it('refreshes a server-rejected token once and retries with the new bearer token', async () => {
    const transportFetch = vi.fn(async (_input, init) => {
      const authorization = new Headers(init?.headers).get('authorization');

      if (authorization === 'Bearer stored-access-token') {
        return new Response(null, { status: 401 });
      }

      return new Response(JSON.stringify({ result: 'ok' }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const { mcpRouter } = await loadRouterWithTransportFetch(transportFetch as typeof fetch);

    const caller = mcpRouter.createCaller(createCallerContext());
    const result = await caller.callTool({
      args: JSON.stringify({ query: 'latest MCP docs' }),
      params: oauthParams,
      toolName: 'tavily_search',
    });

    expect(JSON.parse(result)).toEqual({ result: 'ok' });
    expect(getOAuthTokenMock).toHaveBeenCalledWith('user-id', 'tavily');
    expect(refreshOAuthTokenMock).toHaveBeenCalledTimes(1);
    expect(refreshOAuthTokenMock).toHaveBeenCalledWith('user-id', 'tavily');
    expect(transportFetch).toHaveBeenCalledTimes(2);
    expect(new Headers(transportFetch.mock.calls[0][1]?.headers).get('authorization')).toBe(
      'Bearer stored-access-token',
    );
    expect(new Headers(transportFetch.mock.calls[1][1]?.headers).get('authorization')).toBe(
      'Bearer refreshed-access-token',
    );
  });

  it('surfaces malformed MCP errors without HTML, tokens, or URL secrets', async () => {
    const transportFetch = vi.fn().mockResolvedValue(
      new Response('<!DOCTYPE html><html>stored-access-token query-secret</html>', {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { mcpRouter } = await loadRouterWithTransportFetch(transportFetch as typeof fetch);

    const caller = mcpRouter.createCaller(createCallerContext());
    const error = await caller
      .callTool({
        args: JSON.stringify({ query: 'latest MCP docs' }),
        params: oauthParams,
        toolName: 'tavily_search',
      })
      .catch((caughtError: unknown) => caughtError);
    const serializedError = JSON.stringify(error);

    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).message).toBe('The MCP tool call failed.');
    expect(serializedError).not.toContain('<!DOCTYPE');
    expect(serializedError).not.toContain('Unexpected token');
    expect(serializedError).not.toContain('stored-access-token');
    expect(serializedError).not.toContain('Authorization');
    expect(serializedError).not.toContain('query-secret');
  });

  it('accepts only structured client failure metadata and emits no HTML body', async () => {
    const previousDebug = process.env.CHATHUB_TOOLS_DEBUG;
    process.env.CHATHUB_TOOLS_DEBUG = '1';
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { mcpRouter } = await loadRouterWithTransportFetch(vi.fn() as unknown as typeof fetch);
    const caller = mcpRouter.createCaller(createCallerContext());

    await expect(
      caller.reportClientFailure({
        bodyBytes: 615,
        bodyKind: 'html',
        diagnosticId: 'td_1234567890abcdef',
        durationMs: 6788,
        failurePhase: 'response_parse',
        htmlMarker: 'doctype',
        httpStatus: 502,
        mediaType: 'text/html',
        reason: 'response_parse_failed',
        responseFingerprint: 'abcdef0123456789',
      }),
    ).resolves.toEqual({ reported: true });

    const event = consoleSpy.mock.calls.find(
      ([prefix]) => prefix === '[chathub-tools-debug:client_rpc_response_failed]',
    );
    expect(event).toBeDefined();
    expect(event?.[1]).toContain('response_parse_failed');
    expect(event?.[1]).not.toContain('<!DOCTYPE');

    consoleSpy.mockRestore();
    if (previousDebug === undefined) delete process.env.CHATHUB_TOOLS_DEBUG;
    else process.env.CHATHUB_TOOLS_DEBUG = previousDebug;
  });
});
