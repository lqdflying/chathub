import {
  ModelCacheDiagnosticContext,
  ModelCacheDiagnosticEvent,
  ModelCacheRuntimeFamily,
  ToolCacheDebugMetadata,
} from '@lobechat/model-runtime';
import { createHmac } from 'node:crypto';

const CACHE_DEBUG_NAMESPACE = 'model-cache-debug';
const OPENAI_COMPATIBLE_CACHE_DEBUG_NAMESPACE = 'openai-compatible-cache-debug';
const FINGERPRINT_HEX_LENGTH = 32;
const NATIVE_PROMPT_CACHE_KEY_PREFIX = 'ch_';

const CACHE_DEBUG_ENV_BY_PROVIDER: Readonly<Record<string, string>> = {
  anthropic: 'DEBUG_ANTHROPIC_CACHE',
  anthropiccompatible: 'DEBUG_ANTHROPICCOMPATIBLE_CACHE',
  azure: 'DEBUG_AZURE_CACHE',
  azureai: 'DEBUG_AZUREAI_CACHE',
  deepseek: 'DEBUG_DEEPSEEK_CACHE',
  google: 'DEBUG_GOOGLE_CACHE',
  minimax: 'DEBUG_MINIMAX_CACHE',
  mimo: 'DEBUG_MIMO_CACHE',
  moonshot: 'DEBUG_MOONSHOT_CACHE',
  openai: 'DEBUG_OPENAI_CACHE',
  openaicompatible: 'DEBUG_OPENAICOMPATIBLE_CACHE',
  vertexai: 'DEBUG_GOOGLE_CACHE',
  zhipu: 'DEBUG_ZHIPU_CACHE',
};

const TRUSTED_PROVIDER_NAMES = new Set(Object.keys(CACHE_DEBUG_ENV_BY_PROVIDER));
const SAFE_ERROR_CLASS_PATTERN = /^\w{1,64}$/i;

interface CreateModelCacheDiagnosticContextOptions {
  continuation?: ModelCacheDiagnosticContext['continuation'];
  provider: string;
  runtimeFamily: ModelCacheRuntimeFamily;
  toolCache?: ToolCacheDebugMetadata;
}

const canonicalizeFingerprintValue = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return typeof value;
  if (seen.has(value)) return '[circular]';

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeFingerprintValue(item, seen));
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalizeFingerprintValue(record[key], seen)]),
  );
};

const getFingerprintKey = (): string | undefined =>
  process.env.KEY_VAULTS_SECRET || process.env.NEXT_AUTH_SECRET;

export const hasModelCacheFingerprintKey = (): boolean => !!getFingerprintKey();

const fingerprintValue = (scope: string, value: unknown): string => {
  const key = getFingerprintKey();
  if (!key) return 'unavailable';

  let serializedValue: string;
  try {
    serializedValue = JSON.stringify(canonicalizeFingerprintValue(value));
  } catch {
    serializedValue = Object.prototype.toString.call(value);
  }

  return createHmac('sha256', key)
    .update(`chathub:model-cache:${scope}\0`)
    .update(serializedValue, 'utf8')
    .digest('hex')
    .slice(0, FINGERPRINT_HEX_LENGTH);
};

const createProtectedIdentifier = (
  scope: string,
  value: string | undefined,
  prefix: 'tb_' | 'tc_' | 'td_',
): string | undefined => {
  if (!value) return undefined;

  const fingerprint = fingerprintValue(scope, value);
  return fingerprint === 'unavailable' ? undefined : `${prefix}${fingerprint}`;
};

export const protectExternalToolsDiagnosticId = (
  diagnosticId: string | undefined,
): string | undefined =>
  createProtectedIdentifier('external-tool-diagnostic-id', diagnosticId, 'td_');

export const protectExternalToolCacheDebugMetadata = (
  toolCache: ToolCacheDebugMetadata | undefined,
): ToolCacheDebugMetadata | undefined => {
  if (!toolCache) return undefined;

  const batchId = createProtectedIdentifier('external-tool-batch-id', toolCache.batchId, 'tb_');
  const continuationId = createProtectedIdentifier(
    'external-tool-continuation-id',
    toolCache.continuationId,
    'tc_',
  );

  return {
    ...toolCache,
    batchId,
    continuationId,
  };
};

export const createTrustedPromptCacheKey = ({
  fallback,
  sessionId,
  topicId,
  userId,
}: {
  fallback: unknown;
  sessionId?: string;
  topicId?: string;
  userId: string;
}): string | undefined => {
  if (!getFingerprintKey()) return undefined;

  const conversationScope =
    topicId || sessionId
      ? {
          sessionId: sessionId || null,
          topicId: topicId || null,
        }
      : { fallback };
  const fingerprint = fingerprintValue('native-prompt-cache-key', {
    conversationScope,
    userId,
  });

  return fingerprint === 'unavailable'
    ? undefined
    : `${NATIVE_PROMPT_CACHE_KEY_PREFIX}${fingerprint}`;
};

export const isModelCacheDebugEnabled = (provider: string): boolean => {
  const environmentVariable = CACHE_DEBUG_ENV_BY_PROVIDER[provider];
  return !!environmentVariable && process.env[environmentVariable] === '1';
};

export const isAnyModelCacheDebugEnabled = (): boolean =>
  Object.values(CACHE_DEBUG_ENV_BY_PROVIDER).some(
    (environmentVariable) => process.env[environmentVariable] === '1',
  );

export const resolveModelCacheRuntimeFamily = (provider: string): ModelCacheRuntimeFamily => {
  switch (provider) {
    case 'anthropic': {
      return 'anthropic';
    }
    case 'anthropiccompatible': {
      return 'anthropic-compatible';
    }
    case 'azure': {
      return 'azure-openai';
    }
    case 'azureai': {
      return 'azure-ai';
    }
    case 'google':
    case 'vertexai': {
      return 'google';
    }
    case 'openai': {
      return 'openai';
    }
    case 'deepseek':
    case 'minimax':
    case 'mimo':
    case 'moonshot':
    case 'openaicompatible':
    case 'zhipu': {
      return 'openai-compatible';
    }
    default: {
      return 'unknown';
    }
  }
};

const emitModelCacheDiagnostic = (
  namespace: string,
  provider: string,
  runtimeFamily: ModelCacheRuntimeFamily,
  continuation: ModelCacheDiagnosticContext['continuation'],
  toolCache: ToolCacheDebugMetadata | undefined,
  event: ModelCacheDiagnosticEvent,
) => {
  const safeEvent = (() => {
    switch (event.type) {
      case 'request': {
        return {
          apiType: event.apiType,
          cacheMechanism: event.cacheMechanism,
          cachePolicy: {
            cacheControl: event.cachePolicy.cacheControl,
            cacheControlBreakpointCount: event.cachePolicy.cacheControlBreakpointCount,
            cacheTTL: event.cachePolicy.cacheTTL,
            promptCacheKey: event.cachePolicy.promptCacheKey,
            sessionAffinity: event.cachePolicy.sessionAffinity,
            store: event.cachePolicy.store,
          },
          cacheSupport: event.cacheSupport,
          inputItemCount: event.inputItemCount,
          modelFamily: event.modelFamily,
          modelHash: event.modelHash,
          requestHash: event.requestHash,
          stream: event.stream,
          toolCount: event.toolCount,
          type: event.type,
        };
      }
      case 'usage': {
        return {
          apiType: event.apiType,
          cacheStatus: event.cacheStatus,
          cacheSupport: event.cacheSupport,
          requestHash: event.requestHash,
          responseHash: event.responseHash,
          type: event.type,
          usage: {
            inputCacheMissTokens: event.usage.inputCacheMissTokens,
            inputCachedTokens: event.usage.inputCachedTokens,
            inputWriteCacheTokens: event.usage.inputWriteCacheTokens,
            totalInputTokens: event.usage.totalInputTokens,
            totalOutputTokens: event.usage.totalOutputTokens,
            totalTokens: event.usage.totalTokens,
          },
        };
      }
      case 'usage_missing': {
        return {
          apiType: event.apiType,
          cacheStatus: event.cacheStatus,
          cacheSupport: event.cacheSupport,
          reason: event.reason,
          requestHash: event.requestHash,
          type: event.type,
        };
      }
      case 'terminal_error': {
        return {
          apiType: event.apiType,
          errorClass: SAFE_ERROR_CLASS_PATTERN.test(event.errorClass)
            ? event.errorClass
            : 'ProviderError',
          errorCode: event.errorCode,
          requestHash: event.requestHash,
          terminalReason: event.terminalReason,
          terminalSource: event.terminalSource,
          type: event.type,
        };
      }
    }
  })();

  console.log(
    `[${namespace}:${event.type}]`,
    JSON.stringify({
      ...safeEvent,
      continuation: continuation ?? null,
      provider: TRUSTED_PROVIDER_NAMES.has(provider) ? provider : 'unknown',
      runtimeFamily,
      toolCache: toolCache
        ? {
            inputItemCount: toolCache.inputItemCount ?? null,
            toolCallCount: toolCache.toolCallCount,
            toolCallSetHash: toolCache.toolCallSetHash,
            toolResultCount: toolCache.toolResults?.length ?? 0,
          }
        : null,
    }),
  );
};

export const createModelCacheDiagnosticContext = ({
  continuation,
  provider,
  runtimeFamily,
  toolCache,
}: CreateModelCacheDiagnosticContextOptions): ModelCacheDiagnosticContext | undefined => {
  if (!isModelCacheDebugEnabled(provider)) return undefined;
  if (!getFingerprintKey()) {
    console.warn(
      `[${CACHE_DEBUG_NAMESPACE}:disabled] Cache diagnostics require KEY_VAULTS_SECRET or NEXT_AUTH_SECRET for keyed fingerprints.`,
    );
    return undefined;
  }

  const namespace =
    provider === 'openaicompatible'
      ? OPENAI_COMPATIBLE_CACHE_DEBUG_NAMESPACE
      : CACHE_DEBUG_NAMESPACE;
  const emittedEvents = new Set<string>();
  const protectedToolCache = protectExternalToolCacheDebugMetadata(toolCache);
  const protectedBatchId = continuation
    ? createProtectedIdentifier('external-tool-batch-id', continuation.batchId, 'tb_')
    : undefined;
  const protectedContinuationId = continuation
    ? createProtectedIdentifier('external-tool-continuation-id', continuation.continuationId, 'tc_')
    : undefined;
  const protectedContinuation =
    continuation && protectedBatchId && protectedContinuationId
      ? {
          ...continuation,
          batchId: protectedBatchId,
          continuationId: protectedContinuationId,
        }
      : undefined;

  return {
    continuation: protectedContinuation,
    emit: (event) => {
      const eventKey = [
        event.type,
        'requestHash' in event ? event.requestHash : undefined,
        'responseHash' in event ? event.responseHash : undefined,
        'reason' in event ? event.reason : undefined,
      ].join(':');
      if (emittedEvents.has(eventKey)) return;

      emittedEvents.add(eventKey);
      emitModelCacheDiagnostic(
        namespace,
        provider,
        runtimeFamily,
        protectedContinuation,
        protectedToolCache,
        event,
      );
    },
    fingerprint: fingerprintValue,
    provider: TRUSTED_PROVIDER_NAMES.has(provider) ? provider : 'unknown',
    runtimeFamily,
    toolCache: protectedToolCache,
  };
};
