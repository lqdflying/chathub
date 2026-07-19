import { normalizeCompatSeedJSON } from './openaicompatCache';
import type {
  ToolCacheDebugMetadata,
  ToolCacheDebugPolicy,
  ToolResultDebugSummary,
} from '@lobechat/types';
import {
  buildEffectiveProviderURL,
  summarizeProviderDebugURL,
} from '../../utils/providerDebug';

type OpenAICompatRoute = '/chat/completions' | '/responses';

type DebugSecretSummary =
  | {
      hash: string;
      present: true;
    }
  | {
      present: false;
    };

type DebugUsage = {
  cacheMissTokens?: number | null;
  cachedTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  promptTokens?: number | null;
  requestId?: string | null;
  responseId?: string | null;
  totalTokens?: number | null;
};

const TOOL_CACHE_HASH_PATTERN = /^[\da-f]{16}$/;
const TOOL_CACHE_MAX_INPUT_ITEMS = 1_000_000;
const TOOL_CACHE_MAX_TOOL_CALLS = 100;
const TOOL_RESULT_DEBUG_MAX_SERIALIZED_LENGTH = 32_768;
const TOOL_RESULT_TYPES = new Set<ToolResultDebugSummary['type']>([
  'array',
  'bigint',
  'boolean',
  'function',
  'null',
  'number',
  'object',
  'string',
  'symbol',
  'undefined',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isBoundedInteger = (value: unknown, maximum: number): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= maximum;

const sanitizeToolCachePolicy = (value: unknown): ToolCacheDebugPolicy | undefined => {
  if (!isRecord(value)) return undefined;

  const policy: ToolCacheDebugPolicy = {};

  if (value.chatPromptCacheKey === null || typeof value.chatPromptCacheKey === 'boolean') {
    policy.chatPromptCacheKey = value.chatPromptCacheKey;
  } else if (value.chatPromptCacheKey !== undefined) {
    return undefined;
  }

  if (value.chatSessionHeader === null || typeof value.chatSessionHeader === 'boolean') {
    policy.chatSessionHeader = value.chatSessionHeader;
  } else if (value.chatSessionHeader !== undefined) {
    return undefined;
  }

  if (
    value.responsePromptCacheKey === null ||
    value.responsePromptCacheKey === 'derived' ||
    value.responsePromptCacheKey === 'off'
  ) {
    policy.responsePromptCacheKey = value.responsePromptCacheKey;
  } else if (value.responsePromptCacheKey !== undefined) {
    return undefined;
  }

  if (value.responseSessionHeader === null || typeof value.responseSessionHeader === 'boolean') {
    policy.responseSessionHeader = value.responseSessionHeader;
  } else if (value.responseSessionHeader !== undefined) {
    return undefined;
  }

  if (
    value.responseStateMode === null ||
    value.responseStateMode === 'provider' ||
    value.responseStateMode === 'stateless'
  ) {
    policy.responseStateMode = value.responseStateMode;
  } else if (value.responseStateMode !== undefined) {
    return undefined;
  }

  if (
    value.responseStore === null ||
    value.responseStore === 'default' ||
    value.responseStore === 'false' ||
    value.responseStore === 'true'
  ) {
    policy.responseStore = value.responseStore;
  } else if (value.responseStore !== undefined) {
    return undefined;
  }

  return policy;
};

const sanitizeToolResultSummary = (value: unknown): ToolResultDebugSummary | undefined => {
  if (!isRecord(value)) return undefined;
  if (!isBoundedInteger(value.serializedLength, TOOL_RESULT_DEBUG_MAX_SERIALIZED_LENGTH)) {
    return undefined;
  }
  if (typeof value.type !== 'string' || !TOOL_RESULT_TYPES.has(value.type as any)) {
    return undefined;
  }
  if (typeof value.valueHash !== 'string' || !TOOL_CACHE_HASH_PATTERN.test(value.valueHash)) {
    return undefined;
  }

  const summary: ToolResultDebugSummary = {
    serializedLength: value.serializedLength,
    type: value.type as ToolResultDebugSummary['type'],
    valueHash: value.valueHash,
  };

  if (value.itemCount !== undefined) {
    if (!isBoundedInteger(value.itemCount, TOOL_CACHE_MAX_INPUT_ITEMS)) return undefined;
    summary.itemCount = value.itemCount;
  }
  if (value.propertyCount !== undefined) {
    if (!isBoundedInteger(value.propertyCount, TOOL_CACHE_MAX_INPUT_ITEMS)) return undefined;
    summary.propertyCount = value.propertyCount;
  }
  if (value.truncated !== undefined) {
    if (typeof value.truncated !== 'boolean') return undefined;
    summary.truncated = value.truncated;
  }

  return summary;
};

export const sanitizeToolCacheDebugMetadata = (
  value: unknown,
): ToolCacheDebugMetadata | undefined => {
  try {
    if (!isRecord(value)) return undefined;
    if (
      !isBoundedInteger(value.toolCallCount, TOOL_CACHE_MAX_TOOL_CALLS) ||
      value.toolCallCount === 0
    ) {
      return undefined;
    }
    if (
      typeof value.toolCallSetHash !== 'string' ||
      !TOOL_CACHE_HASH_PATTERN.test(value.toolCallSetHash)
    ) {
      return undefined;
    }

    const metadata: ToolCacheDebugMetadata = {
      toolCallCount: value.toolCallCount,
      toolCallSetHash: value.toolCallSetHash,
    };

    if (value.cachePolicy !== undefined) {
      const cachePolicy = sanitizeToolCachePolicy(value.cachePolicy);
      if (!cachePolicy) return undefined;
      metadata.cachePolicy = cachePolicy;
    }
    if (value.inputItemCount !== undefined) {
      if (!isBoundedInteger(value.inputItemCount, TOOL_CACHE_MAX_INPUT_ITEMS)) return undefined;
      metadata.inputItemCount = value.inputItemCount;
    }
    if (value.toolResults !== undefined) {
      if (
        !Array.isArray(value.toolResults) ||
        value.toolResults.length > TOOL_CACHE_MAX_TOOL_CALLS
      ) {
        return undefined;
      }

      const toolResults = value.toolResults.map(sanitizeToolResultSummary);
      if (toolResults.some((result) => !result)) return undefined;
      metadata.toolResults = toolResults as ToolResultDebugSummary[];
    }

    return metadata;
  } catch {
    return undefined;
  }
};

const stableHash = (value: unknown) => {
  const text = typeof value === 'string' ? value : normalizeCompatSeedJSON(value);
  let hash = 2_166_136_261;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
};

const stableHash16 = (value: unknown) => {
  const text = typeof value === 'string' ? value : normalizeCompatSeedJSON(value);
  let firstLane = 0x81_1C_9D_C5;
  let secondLane = 0x9E_37_79_B9;

  for (let index = 0; index < text.length; index += 1) {
    const characterCode = text.charCodeAt(index);
    firstLane = Math.imul(firstLane ^ characterCode, 0x01_00_01_93);
    secondLane = Math.imul(secondLane ^ (characterCode + index), 0x85_EB_CA_6B);
  }

  return `${(firstLane >>> 0).toString(16).padStart(8, '0')}${(secondLane >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
};

const summarizeSecret = (value: unknown): DebugSecretSummary => {
  if (typeof value !== 'string' || value.length === 0) return { present: false };

  return {
    hash: stableHash(value),
    present: true,
  };
};

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};

const itemKind = (item: any) => {
  if (!item || typeof item !== 'object') return typeof item;

  const role = typeof item.role === 'string' ? item.role : '';
  const type = typeof item.type === 'string' ? item.type : '';
  if (role && type) return `${role}:${type}`;
  return role || type || 'object';
};

const contentShape = (content: unknown) => {
  if (typeof content === 'string') return 'text';
  if (!Array.isArray(content)) return content === undefined || content === null ? 'empty' : typeof content;

  return content
    .map((part) => {
      const value = asRecord(part);
      return typeof value.type === 'string' ? value.type : typeof part;
    })
    .join(',');
};

const sequenceSummary = (items: unknown) => {
  if (!Array.isArray(items)) return { count: 0, sequence: [] as string[] };

  return {
    count: items.length,
    sequence: items.map((item: any) => `${itemKind(item)}:${contentShape(item?.content)}`),
  };
};

const toolSummary = (tools: unknown) => {
  if (!Array.isArray(tools)) return { count: 0, fingerprint: stableHash([]) };

  return {
    count: tools.length,
    fingerprint: stableHash(tools),
  };
};

const responseParamShape = (payload: Record<string, any>) => ({
  hasMaxOutputTokens: payload.max_output_tokens !== undefined,
  hasMaxTokens: payload.max_tokens !== undefined,
  hasTextVerbosity: asRecord(payload.text).verbosity !== undefined,
  hasTopLevelVerbosity: payload.verbosity !== undefined,
  truncation: payload.truncation ?? null,
});

const cacheSummary = (payload: Record<string, any>, headers?: Record<string, any>) => ({
  promptCacheKey: summarizeSecret(payload.prompt_cache_key),
  sessionId: summarizeSecret(headers?.Session_id ?? headers?.session_id),
  store: payload.store ?? null,
});

export const debugOpenAICompatCacheRequest = ({
  baseURL,
  debugToolCache,
  headers,
  payload,
  route,
}: {
  baseURL?: string;
  debugToolCache?: ToolCacheDebugMetadata;
  headers?: Record<string, any>;
  payload: Record<string, any>;
  route: OpenAICompatRoute;
}): string => {
  const items = route === '/responses' ? payload.input : payload.messages;
  const sequence = sequenceSummary(items);
  const requestHash = stableHash16({ payload, route });

  console.log(
    '[openai-compatible-cache-debug:request]',
    JSON.stringify({
      cache: cacheSummary(payload, headers),
      effectiveURL: summarizeProviderDebugURL(buildEffectiveProviderURL(baseURL, route)),
      fingerprint: stableHash(payload),
      inputItemCount: sequence.count,
      model: payload.model,
      params: responseParamShape(payload),
      reasoningEffort: payload.reasoning?.effort ?? payload.reasoning_effort ?? null,
      requestHash,
      route,
      stream: payload.stream ?? null,
      toolCache: sanitizeToolCacheDebugMetadata(debugToolCache) ?? null,
      toolChoice: payload.tool_choice ? summarizeSecret(normalizeCompatSeedJSON(payload.tool_choice)) : null,
      tools: toolSummary(payload.tools),
      turnShape: sequence,
    }),
  );

  return requestHash;
};

export const debugOpenAICompatCacheUsage = ({
  model,
  requestHash,
  route,
  toolCache,
  usage,
}: {
  model?: string;
  requestHash?: string;
  route: OpenAICompatRoute;
  toolCache?: ToolCacheDebugMetadata;
  usage: DebugUsage;
}) => {
  const responseHash = stableHash16({
    model,
    requestHash,
    responseId: usage.responseId ?? null,
    route,
  });

  console.log(
    '[openai-compatible-cache-debug:usage]',
    JSON.stringify({
      cacheMissTokens: usage.cacheMissTokens ?? null,
      cachedTokens: usage.cachedTokens ?? null,
      inputTokens: usage.inputTokens ?? null,
      model,
      outputTokens: usage.outputTokens ?? null,
      promptTokens: usage.promptTokens ?? null,
      requestHash: requestHash ?? null,
      requestId: summarizeSecret(usage.requestId),
      responseHash,
      responseId: summarizeSecret(usage.responseId),
      route,
      toolCache: sanitizeToolCacheDebugMetadata(toolCache) ?? null,
      totalTokens: usage.totalTokens ?? null,
    }),
  );
};
