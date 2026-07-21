import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/const/version', () => ({
  isDesktop: false,
  isServerMode: true,
}));

vi.mock('@/libs/trpc/lambda/middleware/serverDatabase', () => ({
  serverDatabase: vi.fn(async ({ ctx, next }) => next({ ctx })),
}));

const beginMCPResultInvocationMock = vi.fn();
const persistMCPResultMock = vi.fn();
const recoverMCPResultMock = vi.fn();
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    beginMCPResultInvocation: beginMCPResultInvocationMock,
    persistMCPResult: persistMCPResultMock,
    recoverMCPResult: recoverMCPResultMock,
  })),
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
    beginMCPResultInvocationMock.mockResolvedValue(true);
    persistMCPResultMock.mockResolvedValue(true);
    recoverMCPResultMock.mockResolvedValue(undefined);
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
      const actual =
        await vi.importActual<typeof import('@/server/services/mcp')>('@/server/services/mcp');

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
      invocationId: 'mi_12345678901234567890',
      messageId: 'tool-message-id',
      params: oauthParams,
      toolName: 'tavily_search',
    });

    expect(JSON.parse(result.content)).toEqual({ result: 'ok' });
    expect(result.persistence).toBe('persisted');
    expect(beginMCPResultInvocationMock).toHaveBeenCalledWith(
      'tool-message-id',
      'mi_12345678901234567890',
    );
    expect(persistMCPResultMock).toHaveBeenCalledWith(
      'tool-message-id',
      'mi_12345678901234567890',
      JSON.stringify({ result: 'ok' }),
    );
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
        invocationId: 'mi_12345678901234567890',
        messageId: 'tool-message-id',
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

  it('persists concurrent tool results against their matching message ids', async () => {
    const transportFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: 'ok' }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    sdkCallToolMock.mockImplementation(async ({ name }) => ({
      content: [{ text: JSON.stringify({ tool: name }), type: 'text' }],
      isError: false,
    }));
    const { mcpRouter } = await loadRouterWithTransportFetch(transportFetch as typeof fetch);
    const caller = mcpRouter.createCaller(createCallerContext());
    const calls = [
      ['tavily_search', 'tool-message-search'],
      ['tavily_extract', 'tool-message-extract'],
      ['tavily_map', 'tool-message-map'],
    ] as const;

    const results = await Promise.all(
      calls.map(([toolName, messageId], index) =>
        caller.callTool({
          args: '{}',
          invocationId: `mi_1234567890123456${index.toString().padStart(4, '0')}`,
          messageId,
          params: oauthParams,
          toolName,
        }),
      ),
    );

    expect(results.map(({ persistence }) => persistence)).toEqual([
      'persisted',
      'persisted',
      'persisted',
    ]);
    expect(persistMCPResultMock.mock.calls).toEqual(
      expect.arrayContaining(
        calls.map(([toolName, messageId], index) => [
          messageId,
          `mi_1234567890123456${index.toString().padStart(4, '0')}`,
          JSON.stringify({ tool: toolName }),
        ]),
      ),
    );
  });

  it('returns the valid tool result when direct persistence fails', async () => {
    const transportFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: 'ok' }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    persistMCPResultMock.mockRejectedValueOnce(new Error('database unavailable'));
    const { mcpRouter } = await loadRouterWithTransportFetch(transportFetch as typeof fetch);
    const caller = mcpRouter.createCaller(createCallerContext());

    const result = await caller.callTool({
      args: '{}',
      invocationId: 'mi_12345678901234567890',
      messageId: 'tool-message-id',
      params: oauthParams,
      toolName: 'tavily_search',
    });

    expect(result.persistence).toBe('failed');
    expect(JSON.parse(result.content)).toEqual({ result: 'ok' });
  });

  it('recovers a persisted result only for the matching invocation ID', async () => {
    const { mcpRouter } = await loadRouterWithTransportFetch(vi.fn() as unknown as typeof fetch);
    const caller = mcpRouter.createCaller(createCallerContext());
    recoverMCPResultMock.mockImplementation(async (_messageId, invocationId) =>
      invocationId === 'mi_12345678901234567890'
        ? { content: '{"result":"persisted"}' }
        : undefined,
    );

    await expect(
      caller.recoverToolResult({
        invocationId: 'mi_12345678901234567890',
        messageId: 'tool-message-id',
      }),
    ).resolves.toEqual({
      content: '{"result":"persisted"}',
      persistence: 'persisted',
      recovered: true,
    });
    await expect(
      caller.recoverToolResult({
        invocationId: 'mi_00000000000000000000',
        messageId: 'tool-message-id',
      }),
    ).resolves.toBeNull();
  });

  it('preserves bounded batch correlation in MCP completion diagnostics', async () => {
    const previousDebug = process.env.CHATHUB_TOOLS_DEBUG;
    const previousFingerprintSecret = process.env.NEXT_AUTH_SECRET;
    process.env.CHATHUB_TOOLS_DEBUG = '1';
    process.env.NEXT_AUTH_SECRET = 'test-tool-correlation-secret';
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const transportFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: 'PRIVATE_MCP_RESULT' }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const { mcpRouter } = await loadRouterWithTransportFetch(transportFetch as typeof fetch);
    const caller = mcpRouter.createCaller(createCallerContext());

    await caller.callTool({
      args: JSON.stringify({ query: 'PRIVATE_MCP_ARGUMENT' }),
      invocationId: 'mi_12345678901234567890',
      messageId: 'tool-message-id',
      params: oauthParams,
      toolCacheDebug: {
        batchId: 'tb_1234567890abcdefghij',
        continuationId: 'tc_1234567890abcdefghij',
        failureCount: 0,
        resultCount: 2,
        toolCallCount: 2,
        toolCallSetHash: '0123456789abcdef',
      },
      toolName: 'tavily_search',
    });

    const event = consoleSpy.mock.calls.find(
      ([prefix]) => prefix === '[chathub-tools-debug:call_tool_complete]',
    );
    expect(event).toBeDefined();
    const record = JSON.parse(event?.[1] as string);
    expect(record.toolCache).toMatchObject({
      batchId: expect.stringMatching(/^tb_[\da-f]{32}$/),
      continuationId: expect.stringMatching(/^tc_[\da-f]{32}$/),
      failureCount: 0,
      resultCount: 2,
      toolCallCount: 2,
      toolCallSetHash: '0123456789abcdef',
    });
    expect(event?.[1]).not.toMatch(
      /PRIVATE_MCP_ARGUMENT|PRIVATE_MCP_RESULT|tb_1234567890abcdefghij|tc_1234567890abcdefghij/,
    );

    consoleSpy.mockRestore();
    if (previousDebug === undefined) delete process.env.CHATHUB_TOOLS_DEBUG;
    else process.env.CHATHUB_TOOLS_DEBUG = previousDebug;
    if (previousFingerprintSecret === undefined) delete process.env.NEXT_AUTH_SECRET;
    else process.env.NEXT_AUTH_SECRET = previousFingerprintSecret;
  });

  it('accepts only structured client failure metadata and emits no HTML body', async () => {
    const previousDebug = process.env.CHATHUB_TOOLS_DEBUG;
    const previousFingerprintSecret = process.env.KEY_VAULTS_SECRET;
    process.env.CHATHUB_TOOLS_DEBUG = '1';
    process.env.KEY_VAULTS_SECRET = 'test-deployment-fingerprint-secret';
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { mcpRouter } = await loadRouterWithTransportFetch(vi.fn() as unknown as typeof fetch);
    const caller = mcpRouter.createCaller(createCallerContext());

    await expect(
      caller.reportClientFailure({
        attempt: 1,
        bodyBytes: 615,
        bodyKind: 'html',
        diagnosticId: 'td_1234567890abcdef',
        durationMs: 6788,
        failurePhase: 'response_parse',
        htmlMarker: 'doctype',
        httpStatus: 502,
        mediaType: 'text/html',
        operation: 'persist_tool_result',
        procedure: 'message.update',
        reason: 'response_parse_failed',
        responseFingerprint: 'abcdef0123456789',
        rpcEndpoint: 'lambda',
      }),
    ).resolves.toEqual({ reported: true });

    const event = consoleSpy.mock.calls.find(
      ([prefix]) => prefix === '[chathub-tools-debug:client_rpc_response_failed]',
    );
    expect(event).toBeDefined();
    expect(event?.[1]).toContain('message.update');
    expect(event?.[1]).toContain('lambda');
    expect(event?.[1]).toContain('response_parse_failed');
    expect(event?.[1]).not.toContain('<!DOCTYPE');
    expect(event?.[1]).not.toContain('td_1234567890abcdef');
    expect(JSON.parse(event?.[1] as string).diagnosticId).toMatch(/^td_[\da-f]{32}$/);

    consoleSpy.mockRestore();
    if (previousDebug === undefined) delete process.env.CHATHUB_TOOLS_DEBUG;
    else process.env.CHATHUB_TOOLS_DEBUG = previousDebug;
    if (previousFingerprintSecret === undefined) delete process.env.KEY_VAULTS_SECRET;
    else process.env.KEY_VAULTS_SECRET = previousFingerprintSecret;
  });

  it('retains the server-owned failure-report correlation without fingerprint secrets', async () => {
    const previousDebug = process.env.CHATHUB_TOOLS_DEBUG;
    const previousKeyVaultsSecret = process.env.KEY_VAULTS_SECRET;
    const previousNextAuthSecret = process.env.NEXT_AUTH_SECRET;
    process.env.CHATHUB_TOOLS_DEBUG = '1';
    delete process.env.KEY_VAULTS_SECRET;
    delete process.env.NEXT_AUTH_SECRET;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { mcpRouter } = await loadRouterWithTransportFetch(vi.fn() as unknown as typeof fetch);
    const { runWithToolsDebugContext } = await import('@/libs/logger/toolsDebug');
    const caller = mcpRouter.createCaller(createCallerContext());
    const clientDiagnosticId = 'td_1234567890abcdef';
    const serverDiagnosticId = 'td_serverowned12345678';

    await runWithToolsDebugContext(
      {
        diagnosticId: serverDiagnosticId,
        operation: 'mcp.reportClientFailure',
        runtime: 'server',
        transport: 'http',
      },
      () =>
        caller.reportClientFailure({
          attempt: 1,
          bodyKind: 'network_error',
          diagnosticId: clientDiagnosticId,
          durationMs: 500,
          failurePhase: 'network',
          operation: 'call_tool',
          procedure: 'mcp.callTool',
          reason: 'network_error',
          rpcEndpoint: 'tools',
        }),
    );

    const event = consoleSpy.mock.calls.find(
      ([prefix]) => prefix === '[chathub-tools-debug:client_rpc_response_failed]',
    );
    expect(event).toBeDefined();
    expect(event?.[1]).not.toContain(clientDiagnosticId);
    expect(JSON.parse(event?.[1] as string).diagnosticId).toBe(serverDiagnosticId);

    consoleSpy.mockRestore();
    if (previousDebug === undefined) delete process.env.CHATHUB_TOOLS_DEBUG;
    else process.env.CHATHUB_TOOLS_DEBUG = previousDebug;
    if (previousKeyVaultsSecret === undefined) delete process.env.KEY_VAULTS_SECRET;
    else process.env.KEY_VAULTS_SECRET = previousKeyVaultsSecret;
    if (previousNextAuthSecret === undefined) delete process.env.NEXT_AUTH_SECRET;
    else process.env.NEXT_AUTH_SECRET = previousNextAuthSecret;
  });
});
