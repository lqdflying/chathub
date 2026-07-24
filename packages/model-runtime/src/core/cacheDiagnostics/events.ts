import type { ModelTokensUsage } from '@lobechat/types';

import type {
  ModelCacheAPIType,
  ModelCacheDiagnosticContext,
  ModelCacheMechanism,
  ModelCachePolicy,
  ModelCacheStatus,
  ModelCacheSupportState,
  ModelCacheTerminalErrorMetadata,
  ModelCacheTerminalReason,
  ModelCacheTerminalSource,
} from '../../types/cacheDiagnostics';
import type { ChatStreamCallbacks } from '../../types/chat';

interface EmitModelCacheRequestOptions {
  apiType: ModelCacheAPIType;
  cacheMechanism: ModelCacheMechanism;
  cachePolicy?: ModelCachePolicy;
  cacheSupport: ModelCacheSupportState;
  inputItemCount: number;
  model?: string;
  requestFingerprintSource: unknown;
  stream: boolean;
  toolCount: number;
}

interface EmitModelCacheUsageOptions {
  apiType: ModelCacheAPIType;
  cacheSupport: ModelCacheSupportState;
  requestHash?: string;
  responseFingerprintSource: unknown;
  usage: ModelTokensUsage;
}

const normalizeCounter = (value: number | null | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

const modelCacheTerminalReasons = new Set<ModelCacheTerminalReason>([
  'consumer_cancelled',
  'content_filter',
  'html_response',
  'invalid_json',
  'max_output_tokens',
  'missing_status',
  'provider_error',
  'response_failed',
  'response_incomplete',
  'responses_stream_error',
  'stream_chunk_error',
  'tool_call_correlation_error',
  'unexpected_end',
]);

const modelCacheTerminalSources = new Set<ModelCacheTerminalSource>([
  'missing_terminal_event',
  'provider_terminal_event',
  'request_cancelled',
  'upstream_iterator_exception',
]);

const sanitizeTerminalErrorMetadata = (
  metadata: ModelCacheTerminalErrorMetadata | undefined,
): ModelCacheTerminalErrorMetadata | undefined => {
  if (
    !metadata ||
    !modelCacheTerminalReasons.has(metadata.terminalReason) ||
    !modelCacheTerminalSources.has(metadata.terminalSource)
  ) {
    return undefined;
  }

  return {
    terminalReason: metadata.terminalReason,
    terminalSource: metadata.terminalSource,
  };
};

export const resolveModelCacheStatus = (
  usage: ModelTokensUsage,
  cacheSupport: ModelCacheSupportState,
): ModelCacheStatus => {
  if (cacheSupport === 'unsupported') return 'unsupported';

  const cachedTokens = normalizeCounter(usage.inputCachedTokens);
  const cacheMissTokens = normalizeCounter(usage.inputCacheMissTokens);
  const cacheWriteTokens = normalizeCounter(usage.inputWriteCacheTokens);
  const hasCacheTelemetry =
    cachedTokens !== undefined || cacheMissTokens !== undefined || cacheWriteTokens !== undefined;

  if (!hasCacheTelemetry) return 'not_reported';
  if ((cachedTokens ?? 0) > 0 && (cacheMissTokens ?? 0) > 0) return 'mixed';
  if ((cachedTokens ?? 0) > 0) return 'hit';
  if ((cacheWriteTokens ?? 0) > 0) return 'write';
  return 'miss';
};

export const emitModelCacheRequest = (
  context: ModelCacheDiagnosticContext | undefined,
  options: EmitModelCacheRequestOptions,
): string | undefined => {
  if (!context) return undefined;

  const requestHash = context.fingerprint('request', options.requestFingerprintSource);
  context.emit({
    apiType: options.apiType,
    cacheMechanism: options.cacheMechanism,
    cachePolicy: options.cachePolicy ?? {},
    cacheSupport: options.cacheSupport,
    inputItemCount: Math.max(0, options.inputItemCount),
    modelHash: options.model ? context.fingerprint('model', options.model) : undefined,
    requestHash,
    stream: options.stream,
    toolCount: Math.max(0, options.toolCount),
    type: 'request',
  });

  return requestHash;
};

export const emitModelCacheUsage = (
  context: ModelCacheDiagnosticContext | undefined,
  options: EmitModelCacheUsageOptions,
): void => {
  if (!context) return;

  const usage = {
    inputCacheMissTokens: normalizeCounter(options.usage.inputCacheMissTokens),
    inputCachedTokens: normalizeCounter(options.usage.inputCachedTokens),
    inputWriteCacheTokens: normalizeCounter(options.usage.inputWriteCacheTokens),
    totalInputTokens: normalizeCounter(options.usage.totalInputTokens),
    totalOutputTokens: normalizeCounter(options.usage.totalOutputTokens),
    totalTokens: normalizeCounter(options.usage.totalTokens),
  };

  context.emit({
    apiType: options.apiType,
    cacheStatus: resolveModelCacheStatus(usage, options.cacheSupport),
    cacheSupport: options.cacheSupport,
    requestHash: options.requestHash,
    responseHash: context.fingerprint('response', options.responseFingerprintSource),
    type: 'usage',
    usage,
  });
};

export const emitModelCacheUsageMissing = (
  context: ModelCacheDiagnosticContext | undefined,
  options: {
    apiType: ModelCacheAPIType;
    cacheSupport: ModelCacheSupportState;
    reason: 'provider_omitted_usage' | 'request_failed' | 'runtime_unsupported';
    requestHash?: string;
  },
): void => {
  if (!context) return;

  context.emit({
    apiType: options.apiType,
    cacheStatus: options.cacheSupport === 'unsupported' ? 'unsupported' : 'not_reported',
    cacheSupport: options.cacheSupport,
    reason: options.reason,
    requestHash: options.requestHash,
    type: 'usage_missing',
  });
};

export const emitModelCacheTerminalError = (
  context: ModelCacheDiagnosticContext | undefined,
  options: {
    apiType: ModelCacheAPIType;
    error: unknown;
    metadata?: ModelCacheTerminalErrorMetadata;
    requestHash?: string;
  },
): void => {
  if (!context) return;

  const errorRecord =
    options.error && typeof options.error === 'object'
      ? (options.error as Record<string, unknown>)
      : undefined;
  const errorBody =
    errorRecord?.body && typeof errorRecord.body === 'object'
      ? (errorRecord.body as Record<string, unknown>)
      : undefined;
  const rawCode = errorRecord?.code ?? errorBody?.code ?? errorBody?.reason ?? errorBody?.name;
  const errorCode =
    (typeof rawCode === 'string' && /^\w{2,64}$/i.test(rawCode)) || typeof rawCode === 'number'
      ? String(rawCode)
      : undefined;
  const terminalErrorMetadata = sanitizeTerminalErrorMetadata(options.metadata);

  context.emit({
    apiType: options.apiType,
    errorClass: options.error instanceof Error ? options.error.name : 'ProviderError',
    errorCode,
    requestHash: options.requestHash,
    ...terminalErrorMetadata,
    type: 'terminal_error',
  });
};

export const createModelCacheDiagnosticCallbacks = (
  context: ModelCacheDiagnosticContext | undefined,
  options: {
    apiType: ModelCacheAPIType;
    cacheSupport: ModelCacheSupportState;
    requestHash?: string;
  },
): ChatStreamCallbacks | undefined => {
  if (!context) return undefined;

  let terminalEventEmitted = false;

  return {
    onError: (error, metadata) => {
      if (terminalEventEmitted) return;

      terminalEventEmitted = true;
      emitModelCacheTerminalError(context, {
        apiType: options.apiType,
        error,
        metadata,
        requestHash: options.requestHash,
      });
    },
    onFinal: ({ usage }) => {
      if (terminalEventEmitted) return;
      terminalEventEmitted = true;

      if (!usage) {
        emitModelCacheUsageMissing(context, {
          apiType: options.apiType,
          cacheSupport: options.cacheSupport,
          reason: 'provider_omitted_usage',
          requestHash: options.requestHash,
        });
        return;
      }

      emitModelCacheUsage(context, {
        apiType: options.apiType,
        cacheSupport: options.cacheSupport,
        requestHash: options.requestHash,
        responseFingerprintSource: {
          requestHash: options.requestHash,
          usage,
        },
        usage,
      });
    },
  };
};
