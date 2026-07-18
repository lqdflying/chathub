import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.d.ts';
import type { Progress } from '@modelcontextprotocol/sdk/types.js';
import debug from 'debug';
import { spawn } from 'node:child_process';
import { basename } from 'node:path';

import {
  describeToolsDebugError,
  logToolsDebugSafe,
  logToolsDebugVerbose,
} from '@/libs/logger/toolsDebug';

import {
  MCPClientParams,
  MCPError,
  McpPrompt,
  McpResource,
  McpTool,
  createMCPError,
} from './types';
import type { MCPTokenGetter } from './types';
import { createMCPAuthenticatedFetch } from './http';

const log = debug('lobe-mcp:client');
// MCP tool call timeout (milliseconds), configurable via the environment variable MCP_TOOL_TIMEOUT, default is 60000
// Parse MCP_TOOL_TIMEOUT, only use if it's a valid positive number, otherwise fallback to default 60000
const MCP_TOOL_TIMEOUT = (() => {
  const val = Number(process.env.MCP_TOOL_TIMEOUT);
  return Number.isFinite(val) && val > 0 ? val : 60_000;
})();

/**
 * 预检查 stdio 命令，捕获详细的错误信息
 */
async function preCheckStdioCommand(params: {
  args: string[];
  command: string;
  env?: Record<string, string>;
}): Promise<{
  error?: MCPError;
  success: boolean;
}> {
  return new Promise((resolve) => {
    log('Pre-checking stdio executable %s with %d arguments', basename(params.command), params.args.length);

    const child = spawn(params.command, params.args, {
      env: {
        ...process.env,
        ...getDefaultEnvironment(),
        ...params.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    // 设置超时时间 (5秒)
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGTERM');
        resolve({
          error: createMCPError('INITIALIZATION_TIMEOUT', 'MCP service initialization timeout', {
            errorLog: stderr || 'No stderr output',
            params: {
              args: params.args,
              command: params.command,
            },
            step: 'precheck_timeout',
          }),
          success: false,
        });
      }
    }, 5000);

    // 收集 stdout
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    // 收集 stderr - 这是关键部分
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
      log('Captured stderr chunk (%d bytes)', data.byteLength);
    });

    child.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        log(
          'Process spawn error class=%s code=%s',
          error.name,
          (error as Error & { code?: string }).code,
        );
        resolve({
          error: createMCPError('PROCESS_SPAWN_ERROR', 'Failed to start MCP service process', {
            originalError: error.message,
            params: {
              args: params.args,
              command: params.command,
            },
            step: 'process_spawn',
          }),
          success: false,
        });
      }
    });

    child.on('exit', (code, signal) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);

        if (code === 0) {
          log('Pre-check successful, stdout bytes=%d', Buffer.byteLength(stdout, 'utf8'));
          resolve({ success: true });
        } else {
          log('Pre-check failed with code=%d stderr bytes=%d', code, Buffer.byteLength(stderr, 'utf8'));
          resolve({
            error: createMCPError('CONNECTION_FAILED', 'MCP service startup failed', {
              errorLog: stderr,
              params: {
                args: params.args,
                command: params.command,
              },
              process: {
                exitCode: code || undefined,
                signal: signal || undefined,
              },
              step: 'process_exit',
            }),
            success: false,
          });
        }
      }
    });

    // 发送简单的 JSON-RPC 初始化消息来测试连接
    try {
      const initMessage =
        JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            clientInfo: { name: 'lobe-mcp-precheck', version: '1.0.0' },
            protocolVersion: '2024-11-05',
          },
        }) + '\n';

      child.stdin?.write(initMessage);
      child.stdin?.end();
    } catch (writeError) {
      log('Failed to write to stdin class=%s', writeError instanceof Error ? writeError.name : typeof writeError);
    }
  });
}

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

    switch (params.type) {
      case 'http': {
        const serverUrl = new URL(params.url);
        log('Using HTTP transport with origin and path: %s%s', serverUrl.origin, serverUrl.pathname);

        // 构建头部信息，包括用户自定义的 headers 和认证信息
        const headers: Record<string, string> = { ...params.headers };

        // 处理认证配置
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
              // 不需要认证
              break;
            }
          }
        }

        // 创建 StreamableHTTPClientTransport 并传递 headers
        this.transport = new StreamableHTTPClientTransport(serverUrl, {
          fetch: createMCPAuthenticatedFetch({
            fetchFn: options?.fetchFn,
            initialAccessToken:
              params.auth?.type === 'oauth2' ? params.auth.accessToken : undefined,
            tokenGetter: this.tokenGetter,
          }),
          requestInit: { headers },
        });

        log(
          'HTTP transport created headerCount=%d authorizationConfigured=%s',
          Object.keys(headers).length,
          'Authorization' in headers,
        );

        break;
      }

      case 'stdio': {
        log('Using stdio transport executable=%s args=%d', basename(params.command), params.args.length);

        this.transport = new StdioClientTransport({
          args: params.args,
          command: params.command,
          env: {
            ...getDefaultEnvironment(),
            ...params.env,
          },
        });
        break;
      }

      default: {
        const err = createMCPError(
          'VALIDATION_ERROR',
          `Unsupported MCP connection type: ${(params as any).type}`,
          {
            params: { type: (params as any).type },
          },
        );
        log('Error creating MCP client code=%s', err.code);
        throw err;
      }
    }
  }

  async initialize(options: { onProgress?: (progress: Progress) => void } = {}) {
    log('Initializing MCP connection...');
    const start = Date.now();
    logToolsDebugSafe('mcp_operation_started', { operation: 'initialize' });

    try {
      await this.mcp.connect(this.transport, { onprogress: options.onProgress });
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

      if (this.params.type === 'http') {
        const error = e as Error;
        if (error.message.includes('401'))
          throw createMCPError('AUTHORIZATION_ERROR', error.message);

        throw e;
      }

      // 对于 stdio 连接失败，尝试预检查命令以获取详细错误信息
      if (this.params.type === 'stdio') {
        log('Attempting to pre-check stdio command for detailed error information...');

        const preCheckResult = await preCheckStdioCommand({
          args: this.params.args,
          command: this.params.command,
          env: this.params.env,
        });

        if (!preCheckResult.success && preCheckResult.error) {
          log('Detailed stdio pre-check error captured code=%s', preCheckResult.error.code);
          throw preCheckResult.error;
        }
      }

      // For other connection types or when pre-check doesn't provide more information
      if ((e as any).code === -32_000) {
        throw createMCPError(
          'CONNECTION_FAILED',
          'Failed to connect to MCP server, please check your configuration',
          {
            originalError: (e as Error).message,
            params: {
              args: this.params.args,
              command: this.params.command,
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
          args: this.params.args,
          command: this.params.command,
          type: this.params.type,
        },
        step: 'mcp_connect',
      });
    }
  }

  async disconnect() {
    log('Disconnecting MCP connection...');
    // Assuming the mcp client has a disconnect method
    if (this.mcp && typeof (this.mcp as any).disconnect === 'function') {
      await (this.mcp as any).disconnect();
      log('MCP connection disconnected.');
    } else {
      log('MCP client does not have a disconnect method or is not initialized.');
      // Depending on the transport, we might need specific cleanup
      if (this.transport && typeof (this.transport as any).close === 'function') {
        (this.transport as any).close();
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

  async callTool(toolName: string, args: any) {
    logToolsDebugVerbose('call_tool', { args, timeoutMs: MCP_TOOL_TIMEOUT, toolName });
    try {
      const result = await this.mcp.callTool({ arguments: args, name: toolName }, undefined, {
        timeout: MCP_TOOL_TIMEOUT,
      });
      logToolsDebugVerbose('call_tool_result', result);
      return result;
    } catch (e) {
      logToolsDebugVerbose('call_tool_error', {
        error: describeToolsDebugError(e),
      });

      throw e;
    }
  }
}
