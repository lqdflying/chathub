import type { ModelTokensUsage, ToolCacheDebugMetadata } from '@lobechat/types';

export type ModelCacheDiagnosticEventType =
  'request' | 'terminal_error' | 'usage' | 'usage_missing';

export type ModelCacheAPIType =
  | 'anthropic-messages'
  | 'azure-ai-inference'
  | 'chat-completions'
  | 'google-generate-content'
  | 'responses'
  | 'unknown';

export type ModelCacheMechanism =
  | 'automatic'
  | 'explicit-breakpoint'
  | 'passive'
  | 'provider-resource'
  | 'request-key'
  | 'session-affinity'
  | 'unknown';

export type ModelCacheStatus = 'hit' | 'miss' | 'mixed' | 'not_reported' | 'unsupported' | 'write';

export type ModelCacheSupportState = 'supported' | 'unobservable' | 'unsupported';

export type ModelCacheRuntimeFamily =
  | 'anthropic'
  | 'anthropic-compatible'
  | 'azure-ai'
  | 'azure-openai'
  | 'google'
  | 'openai'
  | 'openai-compatible'
  | 'unknown';

export interface ModelCacheContinuationCorrelation {
  batchId: string;
  continuationId: string;
  expectedToolCallCount: number;
  resultCount?: number;
}

export interface ModelCachePolicy {
  cacheControl?: boolean;
  cacheControlBreakpointCount?: number;
  cacheTTL?: '1h' | '5m' | 'mixed';
  promptCacheKey?: boolean;
  sessionAffinity?: boolean;
  store?: boolean | null;
}

export interface ModelCacheDiagnosticRequest {
  apiType: ModelCacheAPIType;
  cacheMechanism: ModelCacheMechanism;
  cachePolicy: ModelCachePolicy;
  cacheSupport: ModelCacheSupportState;
  inputItemCount: number;
  modelFamily?: string;
  modelHash?: string;
  requestHash: string;
  stream: boolean;
  toolCount: number;
}

export interface ModelCacheDiagnosticUsage {
  apiType: ModelCacheAPIType;
  cacheStatus: ModelCacheStatus;
  cacheSupport: ModelCacheSupportState;
  requestHash?: string;
  responseHash: string;
  usage: Pick<
    ModelTokensUsage,
    | 'inputCacheMissTokens'
    | 'inputCachedTokens'
    | 'inputWriteCacheTokens'
    | 'totalInputTokens'
    | 'totalOutputTokens'
    | 'totalTokens'
  >;
}

export interface ModelCacheDiagnosticUsageMissing {
  apiType: ModelCacheAPIType;
  cacheStatus: 'not_reported' | 'unsupported';
  cacheSupport: ModelCacheSupportState;
  reason: 'provider_omitted_usage' | 'request_failed' | 'runtime_unsupported';
  requestHash?: string;
}

export interface ModelCacheDiagnosticTerminalError {
  apiType: ModelCacheAPIType;
  errorClass: string;
  errorCode?: string;
  requestHash?: string;
}

export type ModelCacheDiagnosticEvent =
  | ({ type: 'request' } & ModelCacheDiagnosticRequest)
  | ({ type: 'terminal_error' } & ModelCacheDiagnosticTerminalError)
  | ({ type: 'usage' } & ModelCacheDiagnosticUsage)
  | ({ type: 'usage_missing' } & ModelCacheDiagnosticUsageMissing);

export interface ModelCacheDiagnosticContext {
  continuation?: ModelCacheContinuationCorrelation;
  emit: (event: ModelCacheDiagnosticEvent) => void;
  fingerprint: (scope: string, value: unknown) => string;
  provider: string;
  runtimeFamily: ModelCacheRuntimeFamily;
  toolCache?: ToolCacheDebugMetadata;
}
