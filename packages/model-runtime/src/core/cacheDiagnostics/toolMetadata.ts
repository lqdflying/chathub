import type {
  ToolCacheDebugMetadata,
  ToolCacheDebugPolicy,
  ToolResultDebugSummary,
} from '@lobechat/types';

const TOOL_CACHE_HASH_PATTERN = /^[\da-f]{16}$/;
const TOOL_BATCH_ID_PATTERN = /^tb_[\w-]{12,80}$/;
const TOOL_CONTINUATION_ID_PATTERN = /^tc_[\w-]{12,80}$/;
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
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;

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
  if (
    typeof value.type !== 'string' ||
    !TOOL_RESULT_TYPES.has(value.type as ToolResultDebugSummary['type'])
  ) {
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

    if (value.batchId !== undefined) {
      if (typeof value.batchId !== 'string' || !TOOL_BATCH_ID_PATTERN.test(value.batchId)) {
        return undefined;
      }
      metadata.batchId = value.batchId;
    }
    if (value.continuationId !== undefined) {
      if (
        typeof value.continuationId !== 'string' ||
        !TOOL_CONTINUATION_ID_PATTERN.test(value.continuationId)
      ) {
        return undefined;
      }
      metadata.continuationId = value.continuationId;
    }
    if (value.failureCount !== undefined) {
      if (!isBoundedInteger(value.failureCount, TOOL_CACHE_MAX_TOOL_CALLS)) return undefined;
      metadata.failureCount = value.failureCount;
    }
    if (value.resultCount !== undefined) {
      if (!isBoundedInteger(value.resultCount, TOOL_CACHE_MAX_TOOL_CALLS)) return undefined;
      metadata.resultCount = value.resultCount;
    }
    if ((metadata.failureCount ?? 0) + (metadata.resultCount ?? 0) > metadata.toolCallCount) {
      return undefined;
    }
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
