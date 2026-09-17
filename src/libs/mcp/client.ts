import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.d.ts';
import type { Progress } from '@modelcontextprotocol/sdk/types.js';
import debug from 'debug';

import {
  describeToolsDebugError,
  logToolsDebugSafe,
  logToolsDebugVerbose,
} from '@/libs/logger/toolsDebug';

import { createMCPAuthenticatedFetch } from './http';
import {
  MCPClientParams,
  MCPError,
  McpPrompt,
  McpResource,
  McpTool,
  createMCPError,
} from './types';
import type { MCPTokenGetter } from './types';

const log = debug('lobe-mcp:client');
// MCP tool call timeout (milliseconds), configurable via the environment variable MCP_TOOL_TIMEOUT, default is 60000
// Parse MCP_TOOL_TIMEOUT, only use if it's a valid positive number, otherwise fallback to default 60000
const MCP_TOOL_TIMEOUT = (() => {
  const val = Number(process.env.MCP_TOOL_TIMEOUT);
  return Number.isFinite(val) && val > 0 ? val : 60_000;
})();

// MCP initialization handshake timeout default (milliseconds). Read at call time via
// MCP_INITIALIZATION_TIMEOUT so a hung connect() cannot wait on undici/SDK defaults forever.
const DEFAULT_INITIALIZATION_TIMEOUT_MS = 30_000;

export class MCPClient {
  private mcp: Client;
  private transport: Transport;
  private params: MCPClientParams;
  private tokenGetter?: MCPTokenGetter;

  /** Whether this client has a dynamic token getter for OAuth refresh. */
  get hasTokenGetter(): boolean {
    return !!this.tokenGetter;
  }

  constructor(
    params: MCPClientParams,
    options?: { fetchFn?: typeof fetch; tokenGetter?: MCPTokenGetter },
  ) {
    this.params = params;
    this.tokenGetter = options?.tokenGetter;
    this.mcp = new Client({ name: 'lobehub-mcp-client', version: '1.0.0' });

    const serverUrl = new URL(params.url);
    log('Using HTTP transport with origin and path: %s%s', serverUrl.origin, serverUrl.pathname);

    const headers: Record<string, string> = { ...params.headers };

    if (params.auth) {
      switch (params.auth.type) {
        case 'bearer': {
          if (params.auth.token) {
            headers['Authorization'] = `Bearer ${params.auth.token}`;
            log('Added Bearer token authentication');
          }
          break;
        }
        case 'oauth2': {
          if (params.auth.accessToken) {
            headers['Authorization'] = `Bearer ${params.auth.accessToken}`;
            log('Added OAuth2 access token authentication (static)');
          } else if (this.tokenGetter) {
            log('OAuth2 authentication configured with dynamic token getter');
          }
          break;
        }

        default: {
          break;
        }
      }
    }

    this.transport = new StreamableHTTPClientTransport(serverUrl, {
      fetch: createMCPAuthenticatedFetch({
        fetchFn: options?.fetchFn,
        initialAccessToken: params.auth?.type === 'oauth2' ? params.auth.accessToken : undefined,
        tokenGetter: this.tokenGetter,
      }),
      requestInit: { headers },
    });

    log(
      'HTTP transport created headerCount=%d authorizationConfigured=%s',
      Object.keys(headers).length,
      'Authorization' in headers,
    );
  }

  async initialize(options: { onProgress?: (progress: Progress) => void } = {}) {
    log('Initializing MCP connection...');
    const start = Date.now();
    logToolsDebugSafe('mcp_operation_started', { operation: 'initialize' });

    try {
      await this.connectWithInitializationTimeout(options.onProgress);
      const capabilities = this.mcp.getServerCapabilities?.();
      const serverVersion = this.mcp.getServerVersion?.();
      logToolsDebugSafe('mcp_operation_complete', {
        capabilities: {
          prompts: !!capabilities?.prompts,
          resources: !!capabilities?.resources,
          tools: !!capabilities?.tools,
        },
        durationMs: Date.now() - start,
        operation: 'initialize',
        serverName: serverVersion?.name || serverVersion?.title,
        serverVersion: serverVersion?.version,
      });
      log('MCP connection initialized.');
    } catch (e) {
      logToolsDebugSafe('mcp_operation_failed', {
        ...describeToolsDebugError(e),
        durationMs: Date.now() - start,
        failurePhase: 'initialize',
        operation: 'initialize',
      });
      log('MCP connection failed class=%s', e instanceof Error ? e.name : typeof e);

      const error = e as Error;
      // Structured errors raised by this client (initialization timeout) pass through unwrapped.
      if ((e as MCPError)?.data?.type === 'INITIALIZATION_TIMEOUT') throw e;
      if (error.message.includes('401')) throw createMCPError('AUTHORIZATION_ERROR', error.message);

      if ((e as any).code === -32_000) {
        throw createMCPError(
          'CONNECTION_FAILED',
          'Failed to connect to MCP server, please check your configuration',
          {
            originalError: (e as Error).message,
            params: {
              type: this.params.type,
            },
            step: 'mcp_connect',
          },
        );
      }

      // Wrap other unknown errors
      throw createMCPError('UNKNOWN_ERROR', (e as Error).message, {
        originalError: (e as Error).message,
        params: {
          type: this.params.type,
        },
        step: 'mcp_connect',
      });
    }
  }

  /**
   * Race the SDK handshake against a hard deadline. A hung connect() previously
   * relied on undici/SDK defaults; on timeout the half-open transport is closed
   * best-effort so sockets are not leaked.
   */
  private async connectWithInitializationTimeout(
    onProgress?: (progress: Progress) => void,
  ): Promise<void> {
    const val = Number(process.env.MCP_INITIALIZATION_TIMEOUT);
    const timeoutMs =
      Number.isFinite(val) && val > 0 ? val : DEFAULT_INITIALIZATION_TIMEOUT_MS;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          createMCPError(
            'INITIALIZATION_TIMEOUT',
            `MCP initialization timed out after ${timeoutMs}ms`,
            {
              params: { type: this.params.type },
              step: 'mcp_connect',
            },
          ),
        );
      }, timeoutMs);
      // Never keep a server process alive for this timer.
      (timer as any)?.unref?.();
    });

    try {
      await Promise.race([
        this.mcp.connect(this.transport, { onprogress: onProgress }),
        timeoutPromise,
      ]);
    } catch (error) {
      if ((error as MCPError)?.data?.type === 'INITIALIZATION_TIMEOUT') {
        try {
          await (this.transport as any)?.close?.();
        } catch {
          // best-effort cleanup of the half-open transport
        }
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async disconnect() {
    log('Disconnecting MCP connection...');
    try {
      // The SDK Client exposes close() (Protocol.close also closes the
      // transport); there is no disconnect() method on it.
      await this.mcp.close();
      log('MCP connection disconnected.');
    } catch (error) {
      log('MCP client close failed, closing transport directly: %s', (error as Error).message);
      if (this.transport && typeof (this.transport as any).close === 'function') {
        await (this.transport as any).close();
        log('Transport closed.');
      }
    }
  }

  async listTools() {
    try {
      log('Listing tools...');
      const { tools } = await this.mcp.listTools();
      logToolsDebugVerbose('list_tools', tools);
      return tools as McpTool[];
    } catch (e) {
      logToolsDebugVerbose('list_tools_error', {
        error: describeToolsDebugError(e),
      });

      if ((e as Error).message.includes('No valid session ID provided')) {
        throw new Error('NoValidSessionId');
      }

      // Surface non-recoverable errors instead of returning [] so settings
      // and chat do not misreport broken MCP servers as having no tools.
      throw e;
    }
  }

  async listResources() {
    try {
      log('Listing resources...');
      const { resources } = await this.mcp.listResources();
      logToolsDebugVerbose('list_resources', resources);
      return resources as McpResource[];
    } catch (e) {
      logToolsDebugVerbose('list_resources_error', {
        error: describeToolsDebugError(e),
      });

      // Surface non-recoverable errors instead of returning [].
      throw e;
    }
  }

  async listPrompts() {
    try {
      log('Listing prompts...');
      const { prompts } = await this.mcp.listPrompts();
      logToolsDebugVerbose('list_prompts', prompts);
      return prompts as McpPrompt[];
    } catch (e) {
      logToolsDebugVerbose('list_prompts_error', {
        error: describeToolsDebugError(e),
      });

      // Surface non-recoverable errors instead of returning [].
      throw e;
    }
  }

  async listManifests() {
    const capabilities = this.mcp.getServerCapabilities();
    log(
      'MCP capabilities tools=%s prompts=%s resources=%s',
      !!capabilities?.tools,
      !!capabilities?.prompts,
      !!capabilities?.resources,
    );

    const [tools, prompts, resources] = await Promise.all([
      capabilities?.tools ? this.listTools() : Promise.resolve([]),
      capabilities?.prompts ? this.listPrompts() : Promise.resolve([]),
      capabilities?.resources ? this.listResources() : Promise.resolve([]),
    ]);

    const manifest = {
      prompts: prompts.length === 0 ? undefined : prompts,
      resources: resources.length === 0 ? undefined : resources,
      title: this.mcp.getServerVersion()?.title,
      tools: tools.length === 0 ? undefined : tools,
      version: this.mcp.getServerVersion()?.version?.replace('v', ''),
    };

    log(
      'Listed manifest tools=%d prompts=%d resources=%d',
      tools.length,
      prompts.length,
      resources.length,
    );

    return manifest;
  }

  async callTool(toolName: string, args: any, options?: { signal?: AbortSignal }) {
    logToolsDebugVerbose('call_tool', { args, timeoutMs: MCP_TOOL_TIMEOUT, toolName });
    try {
      const result = await this.mcp.callTool({ arguments: args, name: toolName }, undefined, {
        signal: options?.signal,
        timeout: MCP_TOOL_TIMEOUT,
      });
      logToolsDebugVerbose('call_tool_result', result);
      return result;
    } catch (e) {
      logToolsDebugVerbose('call_tool_error', {
        error: describeToolsDebugError(e),
      });

      // Same stale-session mapping as listTools so MCPService can evict + retry.
      if ((e as Error).message.includes('No valid session ID provided')) {
        throw new Error('NoValidSessionId');
      }

      throw e;
    }
  }
}
