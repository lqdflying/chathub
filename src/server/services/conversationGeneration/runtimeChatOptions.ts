import type { ChatMethodOptions } from '@lobechat/model-runtime';
import type { ToolCacheDebugMetadata } from '@lobechat/types';

import {
  createModelCacheDiagnosticContext,
  createTrustedPromptCacheKey,
  isModelCacheDebugEnabled,
  resolveModelCacheRuntimeFamily,
} from '@/libs/logger/modelCacheDebug';

export interface ConversationRuntimeChatOptionsInput {
  payload?: {
    messages?: unknown[];
    model?: unknown;
    tools?: unknown;
  };
  provider: string;
  sessionId?: string | null;
  signal?: AbortSignal;
  topicId?: string | null;
  toolCache?: ToolCacheDebugMetadata;
  userId: string;
}

/**
 * Match `/webapi/chat/[provider]` so `DEBUG_*_CACHE` and native prompt-cache
 * keys still apply when ModelRuntime is invoked from the conversation worker.
 */
export const createConversationRuntimeChatOptions = ({
  payload,
  provider,
  sessionId,
  signal,
  topicId,
  toolCache,
  userId,
}: ConversationRuntimeChatOptionsInput): ChatMethodOptions => {
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
    provider,
    runtimeFamily: resolveModelCacheRuntimeFamily(provider),
    toolCache,
  });
  const cacheDiagnosticsDisabled = isModelCacheDebugEnabled(provider) && !cacheDiagnostics;
  const trustedPromptCacheKey = createTrustedPromptCacheKey({
    fallback: {
      messages: Array.isArray(payload?.messages) ? payload.messages.slice(0, 2) : [],
      model: payload?.model,
      tools: payload?.tools,
    },
    sessionId: sessionId ?? undefined,
    topicId: topicId ?? undefined,
    userId,
  });

  return {
    ...(cacheDiagnostics ? { cacheDiagnostics } : {}),
    ...(cacheDiagnosticsDisabled ? { cacheDiagnosticsDisabled } : {}),
    ...(signal ? { signal } : {}),
    ...(trustedPromptCacheKey ? { trustedPromptCacheKey } : {}),
    runtimeProvider: provider,
    user: userId,
  };
};
