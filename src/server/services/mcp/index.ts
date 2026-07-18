import { CheckMcpInstallResult, CustomPluginMetadata } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import { LobeChatPluginApi, LobeChatPluginManifest, PluginSchema } from '@lobehub/chat-plugin-sdk';
import { DeploymentOption } from '@lobehub/market-sdk';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { TRPCError } from '@trpc/server';
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
import {
  describeToolsDebugError,
  fingerprintToolsDebugValue,
  isToolsDebugEnabled,
  logToolsDebugSafe,
  runWithToolsDebugContext,
  summarizeToolsDebugValue,
} from '@/libs/logger/toolsDebug';

import { mcpSystemDepsCheckService } from './deps';
import { McpOAuthService } from './oauth';

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

  private getDebugContext = (params: MCPClientParams, operation: string, toolName?: string) => ({
    connectionHash: isToolsDebugEnabled()
      ? fingerprintToolsDebugValue(this.sanitizeForLogging(params))
      : undefined,
    operation,
    runtime: 'server',
    toolName,
    transport: params.type,
  });

  // --- MCP Interaction ---

  // listTools now accepts MCPClientParams
  async listTools(
    params: MCPClientParams,
    { retryTime, skipCache }: { retryTime?: number; skipCache?: boolean } = {},
    oauthContext?: MCPOAuthContext,
  ): Promise<LobeChatPluginApi[]> {
    return runWithToolsDebugContext(this.getDebugContext(params, 'list_tools'), async () => {
      const start = Date.now();
      logToolsDebugSafe('mcp_operation_started', {
        operation: 'list_tools',
        retryAttempt: retryTime || 0,
        skipCache: !!skipCache,
      });

      try {
        const client = await this.getClient(params, skipCache, oauthContext);
        const result = await client.listTools();
        logToolsDebugSafe('list_tools_complete', {
          count: result.length,
          durationMs: Date.now() - start,
          result: summarizeToolsDebugValue(result),
          retryAttempt: retryTime || 0,
        });
        return result.map<LobeChatPluginApi>((item) => ({
          description: item.description,
          name: item.name,
          parameters: item.inputSchema as PluginSchema,
        }));
      } catch (error) {
        let nextReTryTime = retryTime || 0;
        const willRetry = (error as Error).message === 'NoValidSessionId' && nextReTryTime <= 3;
        logToolsDebugSafe('list_tools_failed', {
          ...describeToolsDebugError(error),
          durationMs: Date.now() - start,
          failurePhase: 'mcp_operation',
          retryAttempt: retryTime || 0,
          willRetry,
        });

        if (willRetry) {
          nextReTryTime = nextReTryTime ? nextReTryTime + 1 : 1;
          return this.listTools(
            params,
            { retryTime: nextReTryTime, skipCache: true },
            oauthContext,
          );
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unable to list tools from the MCP server.',
        });
      }
    });
  }

  // listTools now accepts MCPClientParams
  async listRawTools(params: MCPClientParams): Promise<McpTool[]> {
    const client = await this.getClient(params); // Get client using params

    try {
      const result = await client.listTools();
      logToolsDebugSafe('list_tools_complete', {
        count: result.length,
        operation: 'list_raw_tools',
        result: summarizeToolsDebugValue(result),
      });
      return result;
    } catch (error) {
      logToolsDebugSafe('list_tools_failed', {
        ...describeToolsDebugError(error),
        failurePhase: 'list_raw_tools',
      });
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unable to list tools from the MCP server.',
      });
    }
  }

  // listResources now accepts MCPClientParams
  async listResources(params: MCPClientParams, oauthContext?: MCPOAuthContext): Promise<McpResource[]> {
    return runWithToolsDebugContext(this.getDebugContext(params, 'list_resources'), async () => {
      const start = Date.now();
      logToolsDebugSafe('mcp_operation_started', { operation: 'list_resources' });
      try {
        const client = await this.getClient(params, false, oauthContext);
        const result = await client.listResources();
        logToolsDebugSafe('list_resources_complete', {
          count: result.length,
          durationMs: Date.now() - start,
          result: summarizeToolsDebugValue(result),
        });
        return result;
      } catch (error) {
        logToolsDebugSafe('list_resources_failed', {
          ...describeToolsDebugError(error),
          durationMs: Date.now() - start,
          failurePhase: 'mcp_operation',
        });
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unable to list resources from the MCP server.',
        });
      }
    });
  }

  // listPrompts now accepts MCPClientParams
  async listPrompts(params: MCPClientParams, oauthContext?: MCPOAuthContext): Promise<McpPrompt[]> {
    return runWithToolsDebugContext(this.getDebugContext(params, 'list_prompts'), async () => {
      const start = Date.now();
      logToolsDebugSafe('mcp_operation_started', { operation: 'list_prompts' });
      try {
        const client = await this.getClient(params, false, oauthContext);
        const result = await client.listPrompts();
        logToolsDebugSafe('list_prompts_complete', {
          count: result.length,
          durationMs: Date.now() - start,
          result: summarizeToolsDebugValue(result),
        });
        return result;
      } catch (error) {
        logToolsDebugSafe('list_prompts_failed', {
          ...describeToolsDebugError(error),
          durationMs: Date.now() - start,
          failurePhase: 'mcp_operation',
        });
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unable to list prompts from the MCP server.',
        });
      }
    });
  }

  // callTool now accepts MCPClientParams, toolName, and args
  async callTool(
    params: MCPClientParams,
    toolName: string,
    argsStr: any,
    oauthContext?: MCPOAuthContext,
  ): Promise<any> {
    return runWithToolsDebugContext(this.getDebugContext(params, 'call_tool', toolName), async () => {
      const start = Date.now();
      let failurePhase = 'client_lookup';
      logToolsDebugSafe('call_tool_started', {
        arguments: summarizeToolsDebugValue(argsStr),
        authType: params.type === 'http' ? params.auth?.type || 'none' : 'none',
        timeoutMs: Number(process.env.MCP_TOOL_TIMEOUT) || 60_000,
        toolName,
      });

      try {
        const client = await this.getClient(params, false, oauthContext);
        failurePhase = 'argument_parse';
        const args = safeParseJSON(argsStr);

        failurePhase = 'upstream_call';
        const result = await client.callTool(toolName, args);
        logToolsDebugSafe('call_tool_upstream_complete', {
          contentCount: Array.isArray(result.content) ? result.content.length : 0,
          durationMs: Date.now() - start,
          hasStructuredContent: 'structuredContent' in result && !!result.structuredContent,
          isError: !!result.isError,
          result: summarizeToolsDebugValue(result),
          toolName,
        });

        failurePhase = 'normalization';
        const { content, isError } = result;
        let normalized: unknown;
        let resultKind = 'mcp_result';

        if (isError) {
          normalized = result;
          resultKind = 'mcp_error';
        } else {
          const data = content as { text: string; type: 'text' }[];
          if (!data || data.length === 0) {
            normalized = data;
            resultKind = 'empty';
          } else if (data.length > 1) {
            normalized = data;
            resultKind = 'content_array';
          } else {
            const text = data[0]?.text;
            if (!text) {
              normalized = data;
              resultKind = 'content_array';
            } else {
              const json = safeParseJSON(text);
              normalized = json || text;
              resultKind = json ? 'json' : 'text';
            }
          }
        }

        logToolsDebugSafe('call_tool_normalized', {
          durationMs: Date.now() - start,
          result: summarizeToolsDebugValue(normalized),
          resultKind,
          toolName,
        });
        return normalized;
      } catch (error) {
        logToolsDebugSafe('call_tool_failed', {
          ...describeToolsDebugError(error),
          durationMs: Date.now() - start,
          failurePhase,
          toolName,
        });
        if (error instanceof McpError) return error.message;

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'The MCP tool call failed.',
        });
      }
    });
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
      if (initializing) {
        logToolsDebugSafe('client_cache_lookup', {
          cacheSize: this.clients.size,
          initializationCount: this.clientInitializations.size,
          outcome: 'initialization_in_flight',
          skipCache: true,
        });
        return initializing;
      }
      logToolsDebugSafe('client_cache_lookup', {
        cacheSize: this.clients.size,
        initializationCount: this.clientInitializations.size,
        outcome: 'replace',
        skipCache: true,
      });
      return this.startClientInitialization(key, params, oauthContext, true);
    } else {
      const cached = this.clients.get(key);
      if (cached) {
        if (
          oauthCredentialFingerprint &&
          this.oauthCredentialFingerprints.get(key) !== oauthCredentialFingerprint
        ) {
          logToolsDebugSafe('client_cache_evicted', {
            cacheSize: this.clients.size,
            reason: 'oauth_credential_rotated',
          });
          return this.startClientInitialization(key, params, oauthContext, true);
        } else if (isOAuth && oauthContext && !cached.hasTokenGetter) {
          logToolsDebugSafe('client_cache_evicted', {
            cacheSize: this.clients.size,
            reason: 'oauth_scope_upgrade',
          });
          return this.startClientInitialization(key, params, oauthContext, true);
        } else {
          logToolsDebugSafe('client_cache_lookup', {
            cacheSize: this.clients.size,
            initializationCount: this.clientInitializations.size,
            outcome: 'hit',
          });
          return cached;
        }
      }

      const initializing = this.clientInitializations.get(key);
      if (initializing) {
        logToolsDebugSafe('client_cache_lookup', {
          cacheSize: this.clients.size,
          initializationCount: this.clientInitializations.size,
          outcome: 'initialization_in_flight',
        });
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

    logToolsDebugSafe('client_cache_lookup', {
      cacheSize: this.clients.size,
      initializationCount: this.clientInitializations.size,
      outcome: 'miss',
    });
    return this.startClientInitialization(key, params, oauthContext, false);
  }

  private async startClientInitialization(
    key: string,
    params: MCPClientParams,
    oauthContext: MCPOAuthContext | undefined,
    replace: boolean,
  ): Promise<MCPClient> {
    const start = Date.now();
    logToolsDebugSafe('client_initialization_started', {
      authType: params.type === 'http' ? params.auth?.type || 'none' : 'none',
      cacheSize: this.clients.size,
      replace,
    });
    const initialization = (async () => {
      if (replace) await this.evictClient(key, 'replacement');
      return this.initializeClient(key, params, oauthContext);
    })();
    this.clientInitializations.set(key, initialization);

    try {
      const client = await initialization;
      logToolsDebugSafe('client_initialized', {
        cacheSize: this.clients.size,
        durationMs: Date.now() - start,
        transport: params.type,
      });
      return client;
    } catch (error) {
      logToolsDebugSafe('client_initialization_failed', {
        ...describeToolsDebugError(error),
        durationMs: Date.now() - start,
        failurePhase: 'initialization',
        transport: params.type,
      });
      throw error;
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
        const oauthStart = Date.now();
        const oauthOperation = forceRefresh ? 'refresh' : 'lookup';
        logToolsDebugSafe('oauth_operation_started', {
          operation: oauthOperation,
          reason: forceRefresh ? 'forced_after_unauthorized' : 'credential_lookup',
        });

        try {
          const token = await oauthContext.oauthService.getOAuthToken(
            oauthContext.userId,
            oauthContext.pluginIdentifier,
          );
          if (!token) {
            logToolsDebugSafe('oauth_operation_complete', {
              credentialPresent: false,
              durationMs: Date.now() - oauthStart,
              operation: oauthOperation,
              outcome: 'missing',
            });
            return undefined;
          }

          if (forceRefresh) {
            const refreshed = await oauthContext.oauthService.refreshOAuthToken(
              oauthContext.userId,
              oauthContext.pluginIdentifier,
            );
            logToolsDebugSafe('oauth_operation_complete', {
              credentialPresent: !!refreshed?.accessToken,
              durationMs: Date.now() - oauthStart,
              operation: oauthOperation,
              outcome: refreshed?.accessToken ? 'refreshed' : 'refresh_failed',
            });
            return refreshed?.accessToken;
          }

          const needsRefresh =
            (token.expiresAt && token.expiresAt < Date.now()) ||
            (!token.expiresAt && !!token.refreshToken);
          if (needsRefresh) {
            logToolsDebugSafe('oauth_operation_retry', {
              operation: 'refresh',
              reason: token.expiresAt ? 'expired' : 'refreshable_without_expiry',
            });
            const refreshed = await oauthContext.oauthService.refreshOAuthToken(
              oauthContext.userId,
              oauthContext.pluginIdentifier,
            );
            if (refreshed) {
              logToolsDebugSafe('oauth_operation_complete', {
                credentialPresent: true,
                durationMs: Date.now() - oauthStart,
                operation: 'refresh',
                outcome: 'refreshed',
              });
              return refreshed.accessToken;
            }
            if (token.expiresAt && token.expiresAt < Date.now()) return undefined;
          }

          logToolsDebugSafe('oauth_operation_complete', {
            credentialPresent: true,
            durationMs: Date.now() - oauthStart,
            operation: oauthOperation,
            outcome: 'available',
          });
          return token.accessToken;
        } catch (error) {
          logToolsDebugSafe('oauth_operation_failed', {
            ...describeToolsDebugError(error),
            durationMs: Date.now() - oauthStart,
            failurePhase: oauthOperation,
            operation: oauthOperation,
          });
          throw error;
        }
      };

      try {
        const token = await tokenGetter();
        if (token) resolvedParams = { ...params, auth: { ...params.auth, accessToken: token } };
      } catch (error) {
        logToolsDebugSafe('oauth_operation_failed', {
          ...describeToolsDebugError(error),
          failurePhase: 'prefetch',
          operation: 'prefetch',
        });
      }
    }

    try {
      client = new MCPClient(resolvedParams, { fetchFn: this.fetchFn, tokenGetter });
      await client.initialize({
        onProgress: (progress) => {
          logToolsDebugSafe('client_initialization_progress', {
            progress: progress.progress,
            total: progress.total,
          });
        },
      });
      this.clients.set(key, client);
      if (params.type === 'http' && params.auth?.type === 'oauth2' && !oauthContext) {
        this.oauthCredentialFingerprints.set(
          key,
          this.fingerprint(params.auth.accessToken || ''),
        );
      }
      return client;
    } catch (error) {
      if (client) await this.disconnectClient(client);
      const isStructuredMCPError = typeof error === 'object' && !!error && 'data' in error;

      throw new TRPCError({
        cause: error,
        code: isStructuredMCPError ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_SERVER_ERROR',
        message: 'Unable to initialize the MCP client.',
      });
    }
  }

  private async disconnectClient(client: MCPClient): Promise<void> {
    const start = Date.now();
    try {
      await client.disconnect();
      logToolsDebugSafe('client_disconnect_complete', { durationMs: Date.now() - start });
    } catch (error) {
      logToolsDebugSafe('client_disconnect_failed', {
        ...describeToolsDebugError(error),
        durationMs: Date.now() - start,
      });
    }
  }

  private async evictClient(key: string, reason = 'unspecified'): Promise<void> {
    const client = this.clients.get(key);
    this.clients.delete(key);
    this.oauthCredentialFingerprints.delete(key);
    logToolsDebugSafe('client_cache_evicted', {
      cacheSize: this.clients.size,
      clientPresent: !!client,
      reason,
    });
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
      await this.evictClient(unscopedKey, 'oauth_scope_upgrade');
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
    const start = Date.now();
    logToolsDebugSafe('mcp_operation_started', {
      deploymentOptionCount: input.deploymentOptions.length,
      operation: 'dependency_check',
      platform: process.platform,
    });
    try {
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
      }

      logToolsDebugSafe('mcp_operation_complete', {
        allDependenciesMet: !!bestResult?.allDependenciesMet,
        durationMs: Date.now() - start,
        needsConfig: !!bestResult?.needsConfig,
        operation: 'dependency_check',
        resultCount: results.length,
      });

      return checkResult;
    } catch (error) {
      logToolsDebugSafe('mcp_operation_failed', {
        ...describeToolsDebugError(error),
        durationMs: Date.now() - start,
        failurePhase: 'dependency_check',
        operation: 'dependency_check',
      });
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
