import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock 依赖
vi.mock('@/libs/mcp', () => ({
  MCPClient: vi.fn(),
}));

const MockMCPClient = vi.mocked((await import('@/libs/mcp')).MCPClient);

describe('MCPService', () => {
  let mcpService: any;
  let mockClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 动态导入服务实例
    const { mcpService: importedService } = await import('./index');
    mcpService = importedService;

    // 创建 mock 客户端
    mockClient = {
      callTool: vi.fn(),
      listTools: vi.fn(),
    };

    // Mock getClient 方法返回 mock 客户端
    vi.spyOn(mcpService as any, 'getClient').mockResolvedValue(mockClient);
  });

  describe('diagnostic sanitization', () => {
    it('removes credentials and URL queries from logged HTTP parameters', () => {
      const sanitizedParams = (mcpService as any).sanitizeForLogging({
        auth: { accessToken: 'access-token', type: 'oauth2' },
        env: { PRIVATE_TOKEN: 'environment-secret' },
        headers: { Authorization: 'Bearer header-secret' },
        name: 'tavily',
        type: 'http',
        url: 'https://mcp.tavily.com/mcp/?api_key=query-secret#private-fragment',
      });

      expect(sanitizedParams).toEqual({
        name: 'tavily',
        type: 'http',
        url: 'https://mcp.tavily.com/mcp/',
      });
      expect(JSON.stringify(sanitizedParams)).not.toMatch(
        /access-token|environment-secret|header-secret|query-secret|private-fragment/,
      );
    });
  });

  describe('structured tool diagnostics', () => {
    const mockParams = {
      headers: { Authorization: 'Bearer private-header' },
      name: 'private-mcp-name',
      type: 'http' as const,
      url: 'https://private.example.com/mcp?token=private-query',
    };

    it('emits safe list-tools metadata as prefixed JSON', async () => {
      const originalToolsDebug = process.env.CHATHUB_TOOLS_DEBUG;
      process.env.CHATHUB_TOOLS_DEBUG = '1';
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockClient.listTools.mockResolvedValue([
        { description: 'private description', inputSchema: {}, name: 'private-tool-name' },
      ]);

      try {
        await mcpService.listTools(mockParams);

        const debugCall = consoleLogSpy.mock.calls.find(
          ([prefix]) => prefix === '[chathub-tools-debug:list_tools_complete]',
        );
        expect(debugCall).toBeDefined();
        const record = JSON.parse(debugCall![1]);
        expect(record).toMatchObject({ count: 1, debugLevel: 'safe' });
        expect(record.durationMs).toEqual(expect.any(Number));
        expect(debugCall![1]).not.toMatch(
          /private-header|private-query|private-mcp-name|private-tool-name|private description/,
        );
      } finally {
        consoleLogSpy.mockRestore();
        if (originalToolsDebug === undefined) delete process.env.CHATHUB_TOOLS_DEBUG;
        else process.env.CHATHUB_TOOLS_DEBUG = originalToolsDebug;
      }
    });

    it('keeps raw failures out of safe call-tool records', async () => {
      const originalToolsDebug = process.env.CHATHUB_TOOLS_DEBUG;
      process.env.CHATHUB_TOOLS_DEBUG = '1';
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockClient.callTool.mockRejectedValue(new Error('private upstream failure'));

      try {
        await expect(mcpService.callTool(mockParams, 'private-tool-name', '{}')).rejects.toThrow(
          TRPCError,
        );

        const debugCall = consoleLogSpy.mock.calls.find(
          ([prefix]) => prefix === '[chathub-tools-debug:call_tool_failed]',
        );
        expect(debugCall).toBeDefined();
        const record = JSON.parse(debugCall![1]);
        expect(record).toMatchObject({ debugLevel: 'safe' });
        expect(record.durationMs).toEqual(expect.any(Number));
        expect(debugCall![1]).not.toContain('private upstream failure');
        expect(record.toolName).toBe('private-tool-name');
      } finally {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        if (originalToolsDebug === undefined) delete process.env.CHATHUB_TOOLS_DEBUG;
        else process.env.CHATHUB_TOOLS_DEBUG = originalToolsDebug;
      }
    });
  });

  describe('OAuth token getter', () => {
    const oauthParams = {
      auth: { accessToken: 'stored-access-token', type: 'oauth2' as const },
      name: 'tavily',
      type: 'http' as const,
      url: 'https://mcp.tavily.com/mcp/',
    };

    const createOAuthContext = (token: any, refreshedToken: any) => ({
      oauthService: {
        getOAuthToken: vi.fn().mockResolvedValue(token),
        refreshOAuthToken: vi.fn().mockResolvedValue(refreshedToken),
      },
      pluginIdentifier: 'tavily',
      userId: 'user-id',
    });

    const initializeClientWithOAuth = async (
      oauthContext: ReturnType<typeof createOAuthContext>,
    ) => {
      vi.mocked((mcpService as any).getClient).mockRestore();
      const constructedClient = {
        initialize: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue([]),
      };
      MockMCPClient.mockReturnValue(constructedClient as any);

      await mcpService.listTools(oauthParams, {}, oauthContext as any);

      return {
        constructedClient,
        constructorOptions: MockMCPClient.mock.calls[0][1] as any,
        constructorParams: MockMCPClient.mock.calls[0][0] as any,
      };
    };

    it('refreshes known-expired tokens during normal retrieval', async () => {
      const oauthContext = createOAuthContext(
        {
          accessToken: 'expired-token',
          expiresAt: Date.now() - 1_000,
          refreshToken: 'refresh-token',
        },
        { accessToken: 'fresh-token' },
      );

      const { constructorOptions, constructorParams } =
        await initializeClientWithOAuth(oauthContext);
      const tokenGetter = constructorOptions.tokenGetter;

      await expect(tokenGetter()).resolves.toBe('fresh-token');
      expect(constructorParams.auth.accessToken).toBe('fresh-token');
      expect(oauthContext.oauthService.refreshOAuthToken).toHaveBeenCalledWith('user-id', 'tavily');
    });

    it('forces refresh even when the stored token is unexpired', async () => {
      const oauthContext = createOAuthContext(
        {
          accessToken: 'unexpired-token',
          expiresAt: Date.now() + 60_000,
          refreshToken: 'refresh-token',
        },
        { accessToken: 'forced-fresh-token' },
      );

      const { constructorOptions } = await initializeClientWithOAuth(oauthContext);

      await expect(constructorOptions.tokenGetter({ forceRefresh: true })).resolves.toBe(
        'forced-fresh-token',
      );
      expect(oauthContext.oauthService.refreshOAuthToken).toHaveBeenCalledWith('user-id', 'tavily');
    });

    it('does not replay a token when forced refresh fails', async () => {
      const oauthContext = createOAuthContext(
        {
          accessToken: 'server-rejected-token',
          expiresAt: Date.now() + 60_000,
          refreshToken: 'refresh-token',
        },
        null,
      );

      const { constructorOptions } = await initializeClientWithOAuth(oauthContext);

      await expect(constructorOptions.tokenGetter({ forceRefresh: true })).resolves.toBeUndefined();
    });

    it('preserves unknown-expiry fallback when refresh is unavailable', async () => {
      const oauthContext = createOAuthContext(
        {
          accessToken: 'unknown-expiry-token',
          refreshToken: 'refresh-token',
        },
        null,
      );

      const { constructorOptions } = await initializeClientWithOAuth(oauthContext);

      await expect(constructorOptions.tokenGetter()).resolves.toBe('unknown-expiry-token');
      expect(oauthContext.oauthService.refreshOAuthToken).toHaveBeenCalledWith('user-id', 'tavily');
    });
  });

  describe('callTool', () => {
    const mockParams = {
      name: 'test-mcp',
      type: 'http' as const,
      url: 'https://example.com/mcp',
    };

    it('should return original data when content array is empty', async () => {
      mockClient.callTool.mockResolvedValue({
        content: [],
        isError: false,
      });

      const result = await mcpService.callTool(mockParams, 'testTool', '{}');

      expect(result).toEqual([]);
    });

    it('should return original data when content is null or undefined', async () => {
      mockClient.callTool.mockResolvedValue({
        content: null,
        isError: false,
      });

      const result = await mcpService.callTool(mockParams, 'testTool', '{}');

      expect(result).toBeNull();
    });

    it('should return parsed JSON when single element contains valid JSON', async () => {
      const jsonData = { message: 'Hello World', status: 'success' };
      mockClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(jsonData) }],
        isError: false,
      });

      const result = await mcpService.callTool(mockParams, 'testTool', '{}');

      expect(result).toEqual(jsonData);
    });

    it('should return plain text when single element contains non-JSON text', async () => {
      const textData = 'Hello World';
      mockClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: textData }],
        isError: false,
      });

      const result = await mcpService.callTool(mockParams, 'testTool', '{}');

      expect(result).toBe(textData);
    });

    it('should return original data when single element has no text', async () => {
      const contentData = [{ type: 'text', text: '' }];
      mockClient.callTool.mockResolvedValue({
        content: contentData,
        isError: false,
      });

      const result = await mcpService.callTool(mockParams, 'testTool', '{}');

      expect(result).toEqual(contentData);
    });

    it('should return complete array when content has multiple elements', async () => {
      const multipleContent = [
        { type: 'text', text: 'First message' },
        { type: 'text', text: 'Second message' },
        { type: 'text', text: '{"json": "data"}' },
      ];

      mockClient.callTool.mockResolvedValue({
        content: multipleContent,
        isError: false,
      });

      const result = await mcpService.callTool(mockParams, 'testTool', '{}');

      // 应该直接返回完整的数组，不进行任何处理
      expect(result).toEqual(multipleContent);
    });

    it('should return complete array when content has two elements', async () => {
      const twoContent = [
        { type: 'text', text: 'First message' },
        { type: 'text', text: 'Second message' },
      ];

      mockClient.callTool.mockResolvedValue({
        content: twoContent,
        isError: false,
      });

      const result = await mcpService.callTool(mockParams, 'testTool', '{}');

      expect(result).toEqual(twoContent);
    });

    it('should return error result when isError is true', async () => {
      const errorResult = {
        content: [{ type: 'text', text: 'Error occurred' }],
        isError: true,
      };

      mockClient.callTool.mockResolvedValue(errorResult);

      const result = await mcpService.callTool(mockParams, 'testTool', '{}');

      expect(result).toEqual(errorResult);
    });

    it('should throw TRPCError when client throws error', async () => {
      const error = new Error('MCP client error');
      mockClient.callTool.mockRejectedValue(error);

      await expect(mcpService.callTool(mockParams, 'testTool', '{}')).rejects.toThrow(TRPCError);
    });

    it('should parse args string correctly', async () => {
      const argsObject = { param1: 'value1', param2: 'value2' };
      const argsString = JSON.stringify(argsObject);

      mockClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
        isError: false,
      });

      await mcpService.callTool(mockParams, 'testTool', argsString);

      expect(mockClient.callTool).toHaveBeenCalledWith('testTool', argsObject);
    });
  });

  describe('listTools', () => {
    const mockParams = {
      name: 'test-mcp',
      type: 'http' as const,
      url: 'https://example.com/mcp',
    };

    it('should successfully list tools and transform to LobeChatPluginApi format', async () => {
      const mockTools = [
        {
          name: 'tool1',
          description: 'First test tool',
          inputSchema: {
            type: 'object',
            properties: { param1: { type: 'string' } },
          },
        },
        {
          name: 'tool2',
          description: 'Second test tool',
          inputSchema: {
            type: 'object',
            properties: { param2: { type: 'number' } },
          },
        },
      ];

      mockClient.listTools.mockResolvedValue(mockTools);

      const result = await mcpService.listTools(mockParams);

      expect(mockClient.listTools).toHaveBeenCalled();
      expect(result).toEqual([
        {
          name: 'tool1',
          description: 'First test tool',
          parameters: {
            type: 'object',
            properties: { param1: { type: 'string' } },
          },
        },
        {
          name: 'tool2',
          description: 'Second test tool',
          parameters: {
            type: 'object',
            properties: { param2: { type: 'number' } },
          },
        },
      ]);
    });

    it('should return empty array when no tools available', async () => {
      mockClient.listTools.mockResolvedValue([]);

      const result = await mcpService.listTools(mockParams);

      expect(result).toEqual([]);
    });

    it('should retry with skipCache when NoValidSessionId error occurs (first retry)', async () => {
      const mockTools = [
        {
          name: 'tool1',
          description: 'Test tool',
          inputSchema: { type: 'object' },
        },
      ];

      // First call fails with NoValidSessionId
      mockClient.listTools.mockRejectedValueOnce(new Error('NoValidSessionId'));
      // Second call (with skipCache=true) succeeds
      mockClient.listTools.mockResolvedValueOnce(mockTools);

      const result = await mcpService.listTools(mockParams);

      expect(mockClient.listTools).toHaveBeenCalledTimes(2);
      expect(result).toEqual([
        {
          name: 'tool1',
          description: 'Test tool',
          parameters: { type: 'object' },
        },
      ]);
    });

    it('should retry up to 3 times for NoValidSessionId error', async () => {
      const mockTools = [
        {
          name: 'tool1',
          description: 'Test tool',
          inputSchema: { type: 'object' },
        },
      ];

      // Fail 3 times, succeed on 4th
      mockClient.listTools
        .mockRejectedValueOnce(new Error('NoValidSessionId'))
        .mockRejectedValueOnce(new Error('NoValidSessionId'))
        .mockRejectedValueOnce(new Error('NoValidSessionId'))
        .mockResolvedValueOnce(mockTools);

      const result = await mcpService.listTools(mockParams);

      expect(mockClient.listTools).toHaveBeenCalledTimes(4);
      expect(result).toHaveLength(1);
    });

    it('should throw TRPCError when NoValidSessionId retry exceeds limit', async () => {
      // Fail more than 3 times
      mockClient.listTools.mockRejectedValue(new Error('NoValidSessionId'));

      await expect(mcpService.listTools(mockParams)).rejects.toThrow(TRPCError);
      expect(mockClient.listTools).toHaveBeenCalledTimes(5); // initial + 4 retry attempts (last one fails condition)
    });

    it('should throw TRPCError on other errors without retry', async () => {
      const error = new Error('Connection failed');
      mockClient.listTools.mockRejectedValue(error);

      await expect(mcpService.listTools(mockParams)).rejects.toThrow(TRPCError);
      expect(mockClient.listTools).toHaveBeenCalledTimes(1);
    });

    it('should pass skipCache option to getClient', async () => {
      const mockTools = [
        {
          name: 'tool1',
          description: 'Test tool',
          inputSchema: { type: 'object' },
        },
      ];

      mockClient.listTools.mockResolvedValue(mockTools);

      await mcpService.listTools(mockParams, { skipCache: true });

      // Verify getClient was called with skipCache
      expect(mcpService.getClient).toHaveBeenCalledWith(mockParams, true, undefined);
    });

    it('should throw TRPCError with correct error message', async () => {
      const error = new Error('Custom error message');
      mockClient.listTools.mockRejectedValue(error);

      await expect(mcpService.listTools(mockParams)).rejects.toMatchObject({
        message: 'Unable to list tools from the MCP server.',
        code: 'INTERNAL_SERVER_ERROR',
      });
    });
  });

  describe('client cache lifecycle', () => {
    const params = {
      name: 'test-http',
      type: 'http' as const,
      url: 'https://mcp.example.com/mcp',
    };

    it('coalesces concurrent initialization for the same connection', async () => {
      const { MCPService } = await import('./index');
      const service = new MCPService();
      let finishInitialization: (() => void) | undefined;
      const initialization = new Promise<void>((resolve) => {
        finishInitialization = resolve;
      });
      const client = {
        disconnect: vi.fn(),
        hasTokenGetter: false,
        initialize: vi.fn().mockReturnValue(initialization),
      };
      MockMCPClient.mockReturnValue(client as any);

      const first = (service as any).getClient(params);
      const second = (service as any).getClient(params);

      expect(MockMCPClient).toHaveBeenCalledTimes(1);
      finishInitialization?.();
      const [firstClient, secondClient] = await Promise.all([first, second]);
      expect(firstClient).toBe(client);
      expect(secondClient).toBe(client);
    });

    it('reuses a user-scoped OAuth client when its access token rotates', async () => {
      const { MCPService } = await import('./index');
      const service = new MCPService();
      const client = {
        disconnect: vi.fn(),
        hasTokenGetter: true,
        initialize: vi.fn().mockResolvedValue(undefined),
      };
      MockMCPClient.mockReturnValue(client as any);
      const oauthContext = {
        oauthService: {
          getOAuthToken: vi.fn().mockResolvedValue({ accessToken: 'current-token' }),
          refreshOAuthToken: vi.fn(),
        },
        pluginIdentifier: 'test-http',
        userId: 'user-1',
      };

      await (service as any).getClient(
        { ...params, auth: { accessToken: 'old-token', type: 'oauth2' } },
        false,
        oauthContext,
      );
      const reused = await (service as any).getClient(
        { ...params, auth: { accessToken: 'rotated-token', type: 'oauth2' } },
        false,
        oauthContext,
      );

      expect(reused).toBe(client);
      expect(MockMCPClient).toHaveBeenCalledTimes(1);
    });

    it('disconnects an unscoped OAuth client when refreshable user context becomes available', async () => {
      const { MCPService } = await import('./index');
      const service = new MCPService();
      const unscopedClient = {
        disconnect: vi.fn().mockResolvedValue(undefined),
        hasTokenGetter: false,
        initialize: vi.fn().mockResolvedValue(undefined),
      };
      const scopedClient = {
        disconnect: vi.fn().mockResolvedValue(undefined),
        hasTokenGetter: true,
        initialize: vi.fn().mockResolvedValue(undefined),
      };
      MockMCPClient.mockReturnValueOnce(unscopedClient as any).mockReturnValueOnce(
        scopedClient as any,
      );
      const oauthContext = {
        oauthService: {
          getOAuthToken: vi.fn().mockResolvedValue({ accessToken: 'current-token' }),
          refreshOAuthToken: vi.fn(),
        },
        pluginIdentifier: 'test-http',
        userId: 'user-1',
      };

      await (service as any).getClient({
        ...params,
        auth: { accessToken: 'initial-token', type: 'oauth2' },
      });
      const result = await (service as any).getClient(
        { ...params, auth: { accessToken: 'rotated-token', type: 'oauth2' } },
        false,
        oauthContext,
      );

      expect(unscopedClient.disconnect).toHaveBeenCalledTimes(1);
      expect(result).toBe(scopedClient);
    });

    it('replaces and disconnects an unscoped OAuth client when its access token rotates', async () => {
      const { MCPService } = await import('./index');
      const service = new MCPService();
      const firstClient = {
        disconnect: vi.fn().mockResolvedValue(undefined),
        hasTokenGetter: false,
        initialize: vi.fn().mockResolvedValue(undefined),
      };
      const replacementClient = {
        disconnect: vi.fn().mockResolvedValue(undefined),
        hasTokenGetter: false,
        initialize: vi.fn().mockResolvedValue(undefined),
      };
      MockMCPClient.mockReturnValueOnce(firstClient as any).mockReturnValueOnce(
        replacementClient as any,
      );

      await (service as any).getClient({
        ...params,
        auth: { accessToken: 'old-token', type: 'oauth2' },
      });
      const result = await (service as any).getClient({
        ...params,
        auth: { accessToken: 'rotated-token', type: 'oauth2' },
      });

      expect(firstClient.disconnect).toHaveBeenCalledTimes(1);
      expect(result).toBe(replacementClient);
    });

    it('disconnects a cached client before skipCache replacement', async () => {
      const { MCPService } = await import('./index');
      const service = new MCPService();
      const firstClient = {
        disconnect: vi.fn().mockResolvedValue(undefined),
        hasTokenGetter: false,
        initialize: vi.fn().mockResolvedValue(undefined),
      };
      const replacementClient = {
        disconnect: vi.fn().mockResolvedValue(undefined),
        hasTokenGetter: false,
        initialize: vi.fn().mockResolvedValue(undefined),
      };
      MockMCPClient.mockReturnValueOnce(firstClient as any).mockReturnValueOnce(
        replacementClient as any,
      );

      await (service as any).getClient(params);
      const result = await (service as any).getClient(params, true);

      expect(firstClient.disconnect).toHaveBeenCalledTimes(1);
      expect(result).toBe(replacementClient);
    });

    it('disconnects a partially initialized client after failure', async () => {
      const { MCPService } = await import('./index');
      const service = new MCPService();
      const client = {
        disconnect: vi.fn().mockResolvedValue(undefined),
        hasTokenGetter: false,
        initialize: vi.fn().mockRejectedValue(new Error('initialization failed')),
      };
      MockMCPClient.mockReturnValue(client as any);

      await expect((service as any).getClient(params)).rejects.toThrow(
        'Unable to initialize the MCP client.',
      );
      expect(client.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
