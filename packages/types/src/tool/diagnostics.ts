export interface ToolCallSetCorrelation {
  toolCallCount: number;
  toolCallSetHash: string;
}

export interface ToolResultDebugSummary {
  itemCount?: number;
  propertyCount?: number;
  serializedLength: number;
  truncated?: boolean;
  type:
    | 'array'
    | 'bigint'
    | 'boolean'
    | 'function'
    | 'null'
    | 'number'
    | 'object'
    | 'string'
    | 'symbol'
    | 'undefined';
  valueHash: string;
}

export interface ToolCacheDebugPolicy {
  chatPromptCacheKey?: boolean | null;
  chatSessionHeader?: boolean | null;
  responsePromptCacheKey?: 'derived' | 'off' | null;
  responseSessionHeader?: boolean | null;
  responseStateMode?: 'provider' | 'stateless' | null;
  responseStore?: 'default' | 'false' | 'true' | null;
}

export interface ToolCacheDebugMetadata extends ToolCallSetCorrelation {
  cachePolicy?: ToolCacheDebugPolicy;
  inputItemCount?: number;
  toolResults?: ToolResultDebugSummary[];
}

const hashString = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let hash = 0xCB_F2_9C_E4_84_22_23_25n;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x1_00_00_00_01_B3n);
  }

  return hash.toString(16).padStart(16, '0');
};

const TOOL_RESULT_DEBUG_MAX_SERIALIZED_LENGTH = 32_768;

const serializeForFingerprint = (value: unknown): string => {
  if (typeof value === 'string') return value;

  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return Object.prototype.toString.call(value);
  }
};

export const createToolCallSetCorrelation = (
  toolCallIds: readonly (string | undefined)[],
): ToolCallSetCorrelation => {
  const normalizedToolCallIds = [...new Set(toolCallIds.filter(Boolean) as string[])].sort();

  return {
    toolCallCount: normalizedToolCallIds.length,
    toolCallSetHash: hashString(normalizedToolCallIds.join('\u0000')),
  };
};

export const createToolResultDebugSummary = (value: unknown): ToolResultDebugSummary => {
  const serializedValue = serializeForFingerprint(value);
  const boundedSerializedValue = serializedValue.slice(0, TOOL_RESULT_DEBUG_MAX_SERIALIZED_LENGTH);
  const summary: ToolResultDebugSummary = {
    serializedLength: boundedSerializedValue.length,
    truncated: serializedValue.length > boundedSerializedValue.length,
    type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    valueHash: hashString(boundedSerializedValue),
  };

  if (Array.isArray(value)) {
    summary.itemCount = value.length;
  } else if (value && typeof value === 'object') {
    summary.propertyCount = Object.keys(value).length;
  }

  return summary;
};
