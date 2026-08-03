import { CURRENT_VERSION } from '@lobechat/const';
import { ChatToolPayload, CustomPluginMetadata, ToolCacheDebugMetadata } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import { CallReportRequest } from '@lobehub/market-types';
import { nanoid } from 'nanoid';

import { toolsClient } from '@/libs/trpc/client';
import { TOOLS_DIAGNOSTIC_CONTEXT_KEY } from '@/libs/trpc/client/tools';
import {
  type ToolsRPCResponseErrorDetails,
  findToolsRPCResponseError,
} from '@/libs/trpc/client/toolsResponse';

import { discoverService } from './discover';
import { MCPInvocationError } from './mcpError';
import { rpcDiagnosticsService } from './rpcDiagnostics';

export interface MCPToolCallResult {
  content: string;
  persistence: 'failed' | 'persisted' | 'superseded';
}

/**
 * 计算对象的字节大小
 * @param obj 要计算大小的对象
 * @returns 字节大小
 */
function calculateObjectSizeBytes(obj: any): number {
  try {
    const jsonString = JSON.stringify(obj);
    return new TextEncoder().encode(jsonString).length;
  } catch {
    console.warn('Failed to calculate MCP report object size.');
    return 0;
  }
}

const isAbortError = (error: unknown) => {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; current && depth < 6 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error) {
      const normalizedMessage = current.message.toLowerCase();
      if (
        current.name === 'AbortError' ||
        normalizedMessage === 'aborterror' ||
        normalizedMessage.includes('user aborted') ||
        normalizedMessage.includes('operation was aborted')
      ) {
        return true;
      }
    }
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }

  return false;
};

const MCP_RESULT_RECOVERY_RETRY_DELAY_MS = 500;

const waitForMCPResultRecoveryRetry = (signal?: AbortSignal): Promise<boolean> => {
  if (signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const handleAbort = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      resolve(false);
    };
    const handleTimeout = () => {
      signal?.removeEventListener('abort', handleAbort);
      resolve(true);
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }

    timeoutId = setTimeout(handleTimeout, MCP_RESULT_RECOVERY_RETRY_DELAY_MS);
  });
};

const getSafeTRPCErrorMetadata = (error: unknown) => {
  if (!error || typeof error !== 'object') return {};
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return {};
  const code = (data as { code?: unknown }).code;
  const httpStatus = (data as { httpStatus?: unknown }).httpStatus;
  return {
    httpStatus: typeof httpStatus === 'number' ? httpStatus : undefined,
    trpcCode: typeof code === 'string' ? code : undefined,
  };
};

class MCPService {
  reportClientRPCFailure(
    details: ToolsRPCResponseErrorDetails,
    metadata: {
      attempt?: number;
      diagnosticId: string;
      operation: 'call_tool' | 'finalize_assistant_message' | 'persist_tool_result';
      procedure: 'mcp.callTool' | 'message.update';
      rpcEndpoint: 'lambda' | 'tools';
    },
  ) {
    rpcDiagnosticsService.reportClientRPCFailure(details, metadata);
  }

  async invokeMcpToolCall(
    payload: ChatToolPayload,
    {
      diagnosticId: requestedDiagnosticId,
      messageId,
      signal,
      toolCacheDebug,
      topicId,
    }: {
      diagnosticId?: string;
      messageId: string;
      signal?: AbortSignal;
      toolCacheDebug?: ToolCacheDebugMetadata;
      topicId?: string;
    },
  ): Promise<MCPToolCallResult | undefined> {
    const { pluginSelectors } = await import('@/store/tool/selectors');
    const { getToolStoreState } = await import('@/store/tool/store');

    const s = getToolStoreState();
    const { identifier, arguments: args, apiName } = payload;

    const installPlugin = pluginSelectors.getInstalledPluginById(identifier)(s);
    const customPlugin = pluginSelectors.getCustomPluginById(identifier)(s);

    const plugin = installPlugin || customPlugin;

    if (!plugin) return;

    const diagnosticId = requestedDiagnosticId || `td_${nanoid(20)}`;
    const invocationId = `mi_${nanoid(20)}`;
    const data = {
      args,
      invocationId,
      messageId,
      params: { ...plugin.customParams?.mcp, name: identifier } as any,
      toolCacheDebug,
      toolName: apiName,
    };

    if (plugin.customParams?.mcp?.type !== 'http') {
      throw new Error('This MCP plugin uses an unsupported local transport. Remove or replace it.');
    }

    // 记录调用开始时间
    const callStartTime = Date.now();
    let success = false;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    let result: any;

    try {
      result = await toolsClient.mcp.callTool.mutate(data, {
        context: { [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: diagnosticId },
        signal,
      });

      success = true;
      return result;
    } catch (error) {
      success = false;
      if (signal?.aborted || isAbortError(error)) throw error;

      const responseError = findToolsRPCResponseError(error);
      if (responseError) {
        const responseDetails = { ...responseError.details, diagnosticId };
        errorCode = responseDetails.reason;
        errorMessage = `MCP tools gateway failure: ${responseDetails.reason}`;

        this.reportClientRPCFailure(responseDetails, {
          attempt: 1,
          diagnosticId,
          operation: 'call_tool',
          procedure: 'mcp.callTool',
          rpcEndpoint: 'tools',
        });

        for (let recoveryAttempt = 1; recoveryAttempt <= 2; recoveryAttempt += 1) {
          if (signal?.aborted) throw signal.reason ?? error;

          try {
            const recoveredResult = await toolsClient.mcp.recoverToolResult.mutate(
              { invocationId, messageId },
              {
                context: { [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: diagnosticId },
                signal,
              },
            );
            if (recoveredResult) {
              result = recoveredResult;
              success = true;
              return recoveredResult;
            }
          } catch (recoveryError) {
            if (signal?.aborted || isAbortError(recoveryError)) throw recoveryError;
          }

          if (recoveryAttempt === 1) {
            const retryAllowed = await waitForMCPResultRecoveryRetry(signal);
            if (!retryAllowed) throw signal?.reason ?? error;
          }
        }

        throw new MCPInvocationError({
          ...responseDetails,
          category: 'gateway',
          errorKind: responseDetails.reason,
        });
      }

      const trpcMetadata = getSafeTRPCErrorMetadata(error);
      errorCode = trpcMetadata.trpcCode || 'CALL_FAILED';
      errorMessage = `MCP tool server failure: ${errorCode}`;
      throw new MCPInvocationError({
        bodyKind: 'unexpected_text',
        category: 'server',
        diagnosticId,
        durationMs: Date.now() - callStartTime,
        errorKind: trpcMetadata.trpcCode ? 'server_error' : 'unknown_error',
        failurePhase: 'rpc_server',
        httpStatus: trpcMetadata.httpStatus,
        trpcCode: trpcMetadata.trpcCode,
      });
    } finally {
      // 异步上报调用结果，不影响主流程
      const callEndTime = Date.now();
      const callDurationMs = callEndTime - callStartTime;

      // 计算请求大小
      const inputParams = safeParseJSON(args) || args;

      const requestSizeBytes = calculateObjectSizeBytes(inputParams);
      // 计算响应大小
      const responseSizeBytes = success ? calculateObjectSizeBytes(result) : 0;

      const isCustomPlugin = !!customPlugin;
      // 构造上报数据
      const reportData: CallReportRequest = {
        callDurationMs,
        customPluginInfo: isCustomPlugin
          ? {
              avatar: plugin.manifest?.meta.avatar,
              description: plugin.manifest?.meta.description,
              name: plugin.manifest?.meta.title,
            }
          : undefined,
        errorCode,
        errorMessage,
        identifier,
        isCustomPlugin,
        metadata: {
          appVersion: CURRENT_VERSION,
          mcpType: plugin.customParams?.mcp?.type,
        },
        methodName: apiName,
        methodType: 'tool' as const,
        requestSizeBytes,
        responseSizeBytes,
        sessionId: topicId,
        success,
        version: plugin.manifest?.version || 'unknown',
      };

      // 异步上报，不影响主流程
      discoverService.reportPluginCall(reportData).catch(() => {
        console.warn('Failed to report MCP tool call.');
      });
    }
  }

  async getStreamableMcpServerManifest(
    params: {
      auth?: {
        accessToken?: string;
        token?: string;
        type: 'none' | 'bearer' | 'oauth2';
      };
      headers?: Record<string, string>;
      identifier: string;
      metadata?: CustomPluginMetadata;
      url: string;
    },
    signal?: AbortSignal,
  ) {
    return toolsClient.mcp.getStreamableMcpServerManifest.query(params, { signal });
  }
}

export const mcpService = new MCPService();
