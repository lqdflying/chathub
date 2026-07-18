import { CheckMcpInstallResult, CustomPluginMetadata } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import { LobeChatPluginApi, LobeChatPluginManifest, PluginSchema } from '@lobehub/chat-plugin-sdk';
import { DeploymentOption } from '@lobehub/market-sdk';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { createHash } from 'node:crypto';

import {
  MCPClient,
  MCPClientParams,
  MCPTokenGetter,
  McpPrompt,
  McpResource,
  McpTool,
  StdioMCPParams,
} from '@/libs/mcp';
import { sanitizeMCPURLForLogging } from '@/libs/mcp/http';

import { mcpSystemDepsCheckService } from './deps';
import { McpOAuthService } from './oauth';

const log = debug('lobe-mcp:service');
const safeLog = debug('chathub-tools:safe');

export interface MCPOAuthContext {
  oauthService: McpOAuthService;
  pluginIdentifier: string;
  userId: string;
}

// Removed MCPConnection interface as it's no longer needed

export class MCPService {
  // Store instances of the custom MCPClient, keyed by serialized MCPClientParams
  private clients: Map<string, MCPClient> = new Map();
  private clientInitializations: Map<string, Promise<MCPClient>> = new Map();
  private oauthCredentialFingerprints: Map<string, string> = new Map();
  private fetchFn?: typeof fetch;

  constructor(options: { fetchFn?: typeof fetch } = {}) {
    this.fetchFn = options.fetchFn;
  }

  private sanitizeForLogging = <T extends Record<string, any>>(
    obj: T,
  ): Omit<T, 'auth' | 'env' | 'headers'> => {
    if (!obj) return obj;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { auth: _auth, env: _env, headers: _headers, ...rest } = obj;
    const sanitized = { ...rest };

    if (typeof sanitized.url === 'string') {
      sanitized.url = sanitizeMCPURLForLogging(sanitized.url);
    }

    return sanitized as Omit<T, 'auth' | 'env' | 'headers'>;
  };

  // --- MCP Interaction ---

  // listTools now accepts MCPClientParams
  async listTools(
    params: MCPClientParams,
    { retryTime, skipCache }: { retryTime?: number; skipCache?: boolean } = {},
    oauthContext?: MCPOAuthContext,
  ): Promise<LobeChatPluginApi[]> {
    const start = Date.now();
    const client = await this.getClient(params, skipCache, oauthContext);
    const loggableParams = this.sanitizeForLogging(params);
    log(`Listing tools using client for params: %O`, loggableParams);

    try {
      const result = await client.listTools();
      safeLog('event=list_tools_complete duration_ms=%d count=%d', Date.now() - start, result.length);
      log(
        `Tools listed successfully for params: %O, result count: %d`,
        loggableParams,
        result.length,
      );
      return result.map<LobeChatPluginApi>((item) => ({
        // Assuming identifier is the unique name/id
        description: item.description,
        name: item.name,
        parameters: item.inputSchema as PluginSchema,
      }));
    } catch (error) {
      safeLog('event=list_tools_failed duration_ms=%d', Date.now() - start);
      let nextReTryTime = retryTime || 0;

      if ((error as Error).message === 'NoValidSessionId' && nextReTryTime <= 3) {
        if (!nextReTryTime) {
          nextReTryTime = 1;
        } else {
          nextReTryTime += 1;
        }

        return this.listTools(params, { retryTime: nextReTryTime, skipCache: true }, oauthContext);
      }

      console.error(`Error listing tools for params %O:`, loggableParams, error);
      // Propagate a TRPCError for better handling upstream
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error listing tools from MCP server: ${(error as Error).message}`,
      });
    }
  }

  // listTools now accepts MCPClientParams
  async listRawTools(params: MCPClientParams): Promise<McpTool[]> {
    const client = await this.getClient(params); // Get client using params
    const loggableParams = this.sanitizeForLogging(params);
    log(`Listing tools using client for params: %O`, loggableParams);

    try {
      const result = await client.listTools();
      log(
        `Tools listed successfully for params: %O, result count: %d`,
        loggableParams,
        result.length,
      );
      return result;
    } catch (error) {
      console.error(`Error listing tools for params %O:`, loggableParams, error);
      // Propagate a TRPCError for better handling upstream
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error listing tools from MCP server: ${(error as Error).message}`,
      });
    }
  }

  // listResources now accepts MCPClientParams
  async listResources(params: MCPClientParams, oauthContext?: MCPOAuthContext): Promise<McpResource[]> {
    const client = await this.getClient(params, false, oauthContext); // Get client using params
    const loggableParams = this.sanitizeForLogging(params);
    log(`Listing resources using client for params: %O`, loggableParams);

    try {
      const result = await client.listResources();
      log(
        `Resources listed successfully for params: %O, result count: %d`,
        loggableParams,
        result.length,
      );
      return result;
    } catch (error) {
      console.error(`Error listing resources for params %O:`, loggableParams, error);
      // Propagate a TRPCError for better handling upstream
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error listing resources from MCP server: ${(error as Error).message}`,
      });
    }
  }

  // listPrompts now accepts MCPClientParams
  async listPrompts(params: MCPClientParams, oauthContext?: MCPOAuthContext): Promise<McpPrompt[]> {
    const client = await this.getClient(params, false, oauthContext); // Get client using params
    const loggableParams = this.sanitizeForLogging(params);
    log(`Listing prompts using client for params: %O`, loggableParams);

    try {
      const result = await client.listPrompts();
      log(
        `Prompts listed successfully for params: %O, result count: %d`,
        loggableParams,
        result.length,
      );
      return result;
    } catch (error) {
      console.error(`Error listing prompts for params %O:`, loggableParams, error);
      // Propagate a TRPCError for better handling upstream
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error listing prompts from MCP server: ${(error as Error).message}`,
      });
    }
  }

  // callTool now accepts MCPClientParams, toolName, and args
  async callTool(
    params: MCPClientParams,
    toolName: string,
    argsStr: any,
    oauthContext?: MCPOAuthContext,
  ): Promise<any> {
    const start = Date.now();
    const client = await this.getClient(params, false, oauthContext);

    const args = safeParseJSON(argsStr);
    const loggableParams = this.sanitizeForLogging(params);

    log(`Calling tool "${toolName}" using client for params: %O`, loggableParams);

    try {
      // Delegate the call to the MCPClient instance
      const result = await client.callTool(toolName, args); // Pass args directly
      safeLog('event=call_tool_complete duration_ms=%d', Date.now() - start);
      log(`Tool "${toolName}" called successfully for params: %O`, loggableParams);
      const { content, isError } = result;

      if (isError) return result;

      const data = content as { text: string; type: 'text' }[];

      if (!data || data.length === 0) return data;

      if (data.length > 1) return data;

      const text = data[0]?.text;
      if (!text) return data;

      // try to get json object, which will be stringify in the client
      const json = safeParseJSON(text);
      if (json) return json;

      return text;
    } catch (error) {
      safeLog('event=call_tool_failed duration_ms=%d', Date.now() - start);
      if (error instanceof McpError) {
        const mcpError = error as McpError;

        return mcpError.message;
      }

      console.error(
        'Error calling tool:', toolName, 'for params:', this.sanitizeForLogging(params),
        error,
      );
      // Propagate a TRPCError
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error calling tool "${toolName}" on MCP server: ${(error as Error).message}`,
      });
    }
  }

  // Private method to get or initialize a client based on parameters
  private async getClient(
    params: MCPClientParams,
    skipCache = false,
    oauthContext?: MCPOAuthContext,
  ): Promise<MCPClient> {
    const key = this.serializeParams(params, oauthContext);
    const isOAuth = params.type === 'http' && params.auth?.type === 'oauth2';
    const oauthCredentialFingerprint =
      isOAuth && !oauthContext ? this.fingerprint(params.auth.accessToken || '') : undefined;

    if (isOAuth && oauthContext) {
      await this.evictUnscopedOAuthClient(params, key);
    }

    if (skipCache) {
      const initializing = this.clientInitializations.get(key);
      if (initializing) return initializing;
      return this.startClientInitialization(key, params, oauthContext, true);
    } else {
      const cached = this.clients.get(key);
      if (cached) {
        if (
          oauthCredentialFingerprint &&
          this.oauthCredentialFingerprints.get(key) !== oauthCredentialFingerprint
        ) {
          log('Replacing cached OAuth client after its direct access token rotated');
          return this.startClientInitialization(key, params, oauthContext, true);
        } else if (isOAuth && oauthContext && !cached.hasTokenGetter) {
          log('Evicting cached non-refreshable OAuth client; oauthContext now available');
          return this.startClientInitialization(key, params, oauthContext, true);
        } else {
          safeLog('event=client_cache_hit transport=%s', params.type);
          return cached;
        }
      }

      const initializing = this.clientInitializations.get(key);
      if (initializing) {
        const client = await initializing;
        if (
          oauthCredentialFingerprint &&
          this.oauthCredentialFingerprints.get(key) !== oauthCredentialFingerprint
        ) {
          return this.getClient(params, true, oauthContext);
        }
        if (isOAuth && oauthContext && !client.hasTokenGetter) {
          return this.getClient(params, true, oauthContext);
        }
        return client;
      }
    }

    log('No cached client found, initializing new client');
    return this.startClientInitialization(key, params, oauthContext, false);
  }

  private async startClientInitialization(
    key: string,
    params: MCPClientParams,
    oauthContext: MCPOAuthContext | undefined,
    replace: boolean,
  ): Promise<MCPClient> {
    const initialization = (async () => {
      if (replace) await this.evictClient(key);
      return this.initializeClient(key, params, oauthContext);
    })();
    this.clientInitializations.set(key, initialization);

    try {
      return await initialization;
    } finally {
      if (this.clientInitializations.get(key) === initialization) {
        this.clientInitializations.delete(key);
      }
    }
  }

  private async initializeClient(
    key: string,
    params: MCPClientParams,
    oauthContext?: MCPOAuthContext,
  ): Promise<MCPClient> {
    let tokenGetter: MCPTokenGetter | undefined;
    let resolvedParams = params;
    let client: MCPClient | undefined;

    if (params.type === 'http' && params.auth?.type === 'oauth2' && oauthContext) {
      tokenGetter = async ({ forceRefresh = false } = {}) => {
        const token = await oauthContext.oauthService.getOAuthToken(
          oauthContext.userId,
          oauthContext.pluginIdentifier,
        );
        if (!token) return undefined;

        if (forceRefresh) {
          const refreshed = await oauthContext.oauthService.refreshOAuthToken(
            oauthContext.userId,
            oauthContext.pluginIdentifier,
          );
          return refreshed?.accessToken;
        }

        const needsRefresh =
          (token.expiresAt && token.expiresAt < Date.now()) ||
          (!token.expiresAt && !!token.refreshToken);
        if (needsRefresh) {
          const refreshed = await oauthContext.oauthService.refreshOAuthToken(
            oauthContext.userId,
            oauthContext.pluginIdentifier,
          );
          if (refreshed) return refreshed.accessToken;
          if (token.expiresAt && token.expiresAt < Date.now()) return undefined;
        }

        return token.accessToken;
      };

      try {
        const token = await tokenGetter();
        if (token) resolvedParams = { ...params, auth: { ...params.auth, accessToken: token } };
      } catch {
        log('OAuth token prefetch failed for plugin %s', oauthContext.pluginIdentifier);
      }
    }

    try {
      client = new MCPClient(resolvedParams, { fetchFn: this.fetchFn, tokenGetter });
      await client.initialize({
        onProgress: (progress) => {
          log('New client initializing: %d/%d', progress.progress, progress.total);
        },
      });
      this.clients.set(key, client);
      if (params.type === 'http' && params.auth?.type === 'oauth2' && !oauthContext) {
        this.oauthCredentialFingerprints.set(
          key,
          this.fingerprint(params.auth.accessToken || ''),
        );
      }
      safeLog('event=client_initialized transport=%s', params.type);
      log('New client initialized and cached for plugin: %s', params.name);
      return client;
    } catch (error) {
      if (client) await this.disconnectClient(client);
      safeLog('event=client_initialization_failed transport=%s', params.type);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isStructuredMCPError = typeof error === 'object' && !!error && 'data' in error;

      throw new TRPCError({
        cause: error,
        code: isStructuredMCPError ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_SERVER_ERROR',
        message: errorMessage,
      });
    }
  }

  private async disconnectClient(client: MCPClient): Promise<void> {
    try {
      await client.disconnect();
    } catch {
      log('MCP client disconnect failed during cleanup');
    }
  }

  private async evictClient(key: string): Promise<void> {
    const client = this.clients.get(key);
    this.clients.delete(key);
    this.oauthCredentialFingerprints.delete(key);
    if (client) await this.disconnectClient(client);
  }

  private async evictUnscopedOAuthClient(params: MCPClientParams, scopedKey: string): Promise<void> {
    const unscopedKey = this.serializeParams(params);
    if (unscopedKey === scopedKey) return;

    const initializing = this.clientInitializations.get(unscopedKey);
    if (initializing) {
      try {
        await initializing;
      } catch {
        // The scoped client can still initialize after an unscoped attempt failed.
      }
    }

    if (this.clients.has(unscopedKey)) {
      log('Replacing unscoped OAuth client with a user-scoped refreshable client');
      await this.evictClient(unscopedKey);
    }
  }

  // Canonical, fingerprinted keys keep credentials out of map keys. OAuth keys use stable
  // user/plugin identity when available and deliberately exclude rotating access tokens.
  private serializeParams(params: MCPClientParams, oauthContext?: MCPOAuthContext): string {
    const normalized: Record<string, unknown> = { ...params };
    if (params.type === 'http' && params.auth?.type === 'oauth2') {
      normalized.auth = { type: 'oauth2' };
      normalized.oauthIdentity = oauthContext
        ? { pluginIdentifier: oauthContext.pluginIdentifier, userId: oauthContext.userId }
        : { scope: 'direct-token' };
    }

    return `mcp:${this.fingerprint(this.canonicalStringify(normalized))}`;
  }

  private canonicalStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.canonicalStringify(record[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
  }

  private fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  async getStreamableMcpServerManifest(
    identifier: string,
    url: string,
    metadata?: CustomPluginMetadata,
    auth?: {
      accessToken?: string;
      token?: string;
      type: 'none' | 'bearer' | 'oauth2';
    },
    headers?: Record<string, string>,
    oauthContext?: MCPOAuthContext,
  ): Promise<LobeChatPluginManifest> {
    const mcpParams = { name: identifier, type: 'http' as const, url };

    // 如果有认证信息，添加到参数中
    if (auth) {
      (mcpParams as any).auth = auth;
    }

    // 如果有 headers 信息，添加到参数中
    if (headers) {
      (mcpParams as any).headers = headers;
    }

    const tools = await this.listTools(mcpParams, {}, oauthContext);

    return {
      api: tools,
      identifier,
      meta: {
        avatar: metadata?.avatar || 'MCP_AVATAR',
        description:
          metadata?.description ||
          `${identifier} MCP server has ${tools.length} tools, like "${tools[0]?.name}"`,
        title: identifier,
      },
      // TODO: temporary
      type: 'mcp' as any,
    };
  }

  async getStdioMcpServerManifest(
    params: Omit<StdioMCPParams, 'type'>,
    metadata?: CustomPluginMetadata,
  ): Promise<LobeChatPluginManifest> {
    const client = await this.getClient({
      args: params.args,
      command: params.command,
      env: params.env,
      name: params.name,
      type: 'stdio',
    }); // Get client using params

    const manifest = await client.listManifests();

    const identifier = params.name;

    return {
      api: manifest.tools ? this.transformMCPToolToLobeAPI(manifest.tools) : [],
      identifier,
      meta: {
        avatar: metadata?.avatar || 'MCP_AVATAR',
        description:
          metadata?.description ||
          `${identifier} MCP server has ` +
            Object.entries(manifest)
              .filter(([key]) => ['tools', 'prompts', 'resources'].includes(key))
              .map(([key, item]) => `${(item as Array<any>)?.length} ${key}`)
              .join(','),
        title: metadata?.name || identifier,
      },
      ...manifest,
      // TODO: temporary
      type: 'mcp' as any,
    } as LobeChatPluginManifest;
  }

  /**
   * Check MCP plugin installation status
   */
  async checkMcpInstall(input: {
    deploymentOptions: DeploymentOption[];
  }): Promise<CheckMcpInstallResult> {
    try {
      const loggableInput = {
        deploymentOptions: input.deploymentOptions.map((o) => this.sanitizeForLogging(o)),
      };
      log('Checking MCP plugin installation status: %O', loggableInput);
      const results = [];

      // 检查每个部署选项
      for (const option of input.deploymentOptions) {
        // 使用系统依赖检查服务检查部署选项
        const result = await mcpSystemDepsCheckService.checkDeployOption(option);
        results.push(result);
      }

      // 找出推荐的或第一个可安装的选项
      const recommendedResult = results.find((r) => r.isRecommended && r.allDependenciesMet);
      const firstInstallableResult = results.find((r) => r.allDependenciesMet);

      // 返回推荐的结果，或第一个可安装的结果，或第一个结果
      const bestResult = recommendedResult || firstInstallableResult || results[0];

      log('Check completed, best result: %O', bestResult);

      // 构造返回结果，确保包含配置检查信息
      const checkResult: CheckMcpInstallResult = {
        ...bestResult,
        allOptions: results,
        platform: process.platform,
        success: true,
      };

      // 如果最佳结果需要配置，确保在顶层设置相关字段
      if (bestResult?.needsConfig) {
        checkResult.needsConfig = true;
        checkResult.configSchema = bestResult.configSchema;
        log('Configuration required for best deployment option: %O', bestResult.configSchema);
      }

      return checkResult;
    } catch (error) {
      log('Check failed: %O', error);
      return {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error when checking MCP plugin installation status',
        platform: process.platform,
        success: false,
      };
    }
  }

  private transformMCPToolToLobeAPI = (data: McpTool[]) => {
    return data.map<LobeChatPluginApi>((item) => ({
      // Assuming identifier is the unique name/id
      description: item.description,
      name: item.name,
      parameters: item.inputSchema as PluginSchema,
    }));
  };
}

// Export a singleton instance
export const mcpService = new MCPService();
