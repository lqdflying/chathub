import {
  AGENT_RUNTIME_ERROR_SET,
  ChatCompletionErrorPayload,
  createContextExportCaptureBridge,
  ModelRuntime,
  prependContextSnapshotToResponse,
  sanitizeToolCacheDebugMetadata,
} from '@lobechat/model-runtime';
import { LOBE_CHAT_CONTEXT_EXPORT_HEADER } from '@lobechat/const';
import { ChatErrorType, ContextExportRequestContext } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import {
  createModelCacheDiagnosticContext,
  createTrustedPromptCacheKey,
  isModelCacheDebugEnabled,
  resolveModelCacheRuntimeFamily,
} from '@/libs/logger/modelCacheDebug';
import { createTraceOptions, initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { ChatStreamPayload } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';
import { stripLegacyProviderParams } from '@/utils/stripLegacyProviderParams';
import { getTracePayload } from '@/utils/trace';
import {
  contextExportRedactions,
  sanitizeContextExportValue,
} from '@/services/chat/contextExport';

import { resolveTrustedCatalogModel } from './trustedCatalogModel';

export const maxDuration = 300;

export const POST = checkAuth(async (req: Request, { params, jwtPayload, createRuntime }) => {
  const { provider } = await params;
  let contextExportBridge: ReturnType<typeof createContextExportCaptureBridge> | undefined;
  let contextExportRequest: ContextExportRequestContext | undefined;
  let contextExportRequestMetadata:
    | {
        apiMode?: any;
        model: string;
        provider: string;
        runtime: string;
      }
    | undefined;

  try {
    // ============  1. init chat model   ============ //
    let modelRuntime: ModelRuntime;
    if (createRuntime) {
      modelRuntime = createRuntime(jwtPayload);
    } else {
      modelRuntime = await initModelRuntimeWithUserPayload(provider, jwtPayload);
    }

    // ============  2. create chat completion   ============ //

    const requestPayload = stripLegacyProviderParams((await req.json()) as ChatStreamPayload);
    const catalogModel = requestPayload.catalogModel;
    delete requestPayload.catalogModel;
    delete requestPayload.provider;
    const toolCache = sanitizeToolCacheDebugMetadata(requestPayload.debugToolCache);
    delete requestPayload.debugToolCache;
    const runtimeProvider = jwtPayload.runtimeProvider ?? provider;
    let trustedCatalogModel: string | undefined;
    try {
      trustedCatalogModel = await resolveTrustedCatalogModel({
        catalogModel,
        deploymentName: requestPayload.model,
        runtimeProvider,
        userId: jwtPayload.userId,
      });
    } catch {
      trustedCatalogModel = undefined;
    }
    const data = requestPayload;
    const cacheDiagnostics = createModelCacheDiagnosticContext({
      continuation:
        toolCache?.batchId && toolCache.continuationId
          ? {
              batchId: toolCache.batchId,
              continuationId: toolCache.continuationId,
              expectedToolCallCount: toolCache.toolCallCount,
              resultCount: toolCache.resultCount,
            }
          : undefined,
      provider: runtimeProvider,
      runtimeFamily: resolveModelCacheRuntimeFamily(runtimeProvider),
      toolCache,
    });
    const cacheDiagnosticsDisabled =
      isModelCacheDebugEnabled(runtimeProvider) && !cacheDiagnostics;

    const tracePayload = getTracePayload(req);
    const trustedPromptCacheKey = createTrustedPromptCacheKey({
      fallback: {
        messages: requestPayload.messages?.slice(0, 2) ?? [],
        model: requestPayload.model,
        tools: requestPayload.tools,
      },
      sessionId: tracePayload?.sessionId,
      topicId: tracePayload?.topicId,
      userId: jwtPayload.userId,
    });

    let traceOptions = {};
    // If user enable trace
    if (tracePayload?.enabled) {
      traceOptions = createTraceOptions(data, { provider, trace: tracePayload });
    }

    const serializedContextExportRequest = req.headers.get(LOBE_CHAT_CONTEXT_EXPORT_HEADER);
    contextExportRequest = serializedContextExportRequest
      ? (JSON.parse(serializedContextExportRequest) as ContextExportRequestContext)
      : undefined;
    contextExportBridge = contextExportRequest
      ? createContextExportCaptureBridge(sanitizeContextExportValue)
      : undefined;
    contextExportRequestMetadata = {
      model: data.model,
      provider,
      runtime: runtimeProvider,
    };

    const response = await modelRuntime.chat(data, {
      ...(cacheDiagnostics ? { cacheDiagnostics } : {}),
      ...(cacheDiagnosticsDisabled ? { cacheDiagnosticsDisabled } : {}),
      ...(contextExportBridge
        ? { onRequestPrepared: contextExportBridge.onRequestPrepared }
        : {}),
      runtimeProvider,
      ...(trustedCatalogModel ? { trustedCatalogModel } : {}),
      ...(trustedPromptCacheKey ? { trustedPromptCacheKey } : {}),
      user: jwtPayload.userId,
      ...traceOptions,
      signal: req.signal,
    });

    if (!contextExportRequest || !contextExportBridge) return response;

    return prependContextSnapshotToResponse(
      response,
      contextExportBridge.snapshot.then(({ apiMode, providerRequest }) => ({
        ...contextExportRequest,
        metadata: {
          ...contextExportRequestMetadata,
          apiMode: apiMode as any,
        },
        providerRequest,
        redactions: contextExportRedactions,
        status: 'complete',
      })),
    );
  } catch (e) {
    const {
      errorType = ChatErrorType.InternalServerError,
      error: errorContent,
      ...res
    } = e as ChatCompletionErrorPayload;

    const error = errorContent || e;
    const preparedContextSnapshot = contextExportBridge?.getSnapshot();
    const contextExportSnapshot =
      contextExportRequest && preparedContextSnapshot && contextExportRequestMetadata
        ? {
            ...contextExportRequest,
            error: `Provider request rejected: ${String(errorType)}`,
            metadata: {
              ...contextExportRequestMetadata,
              apiMode: preparedContextSnapshot.apiMode as any,
            },
            providerRequest: preparedContextSnapshot.providerRequest,
            redactions: contextExportRedactions,
            status: 'error' as const,
          }
        : undefined;

    const logMethod = AGENT_RUNTIME_ERROR_SET.has(errorType as string) ? 'warn' : 'error';
    // track the error at server side
    console[logMethod](`Route: [${provider}] ${errorType}:`, error);

    return createErrorResponse(errorType, {
      ...(contextExportSnapshot ? { contextExportSnapshot } : {}),
      error,
      ...res,
      provider,
    });
  }
});
