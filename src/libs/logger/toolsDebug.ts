import debug from 'debug';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';

import {
  TOOLS_SAFE_NS,
  TOOLS_VERBOSE_NS,
  type ToolsDebugLevel,
  parseToolsDebugLevel,
} from './bootstrap';

const safeLegacyLog = debug(TOOLS_SAFE_NS[0]);
const verboseLegacyLog = debug(TOOLS_VERBOSE_NS[0]);

const SECRET_KEY_PATTERN =
  /token|secret|password|api[_-]?key|authorization|cookie|credential|client[_-]?secret|access[_-]?token|refresh[_-]?token|pkce|verifier/i;
const PRIVATE_IDENTIFIER_KEY_PATTERN =
  /^(?:id|(?:user|account|session|connection|request|client|tenant|topic)[_-]?id)$/i;
const SAFE_SECRET_METADATA_KEY_PATTERN = /(?:configured|count|hash|length|present|state)$/i;
const SAFE_LABEL_KEY_PATTERN =
  /^(?:appVersion|architecture|authType|bodyKind|cacheStatus|code|contentEncoding|debugLevel|deploymentMode|endpoint|errorClass|errorCode|errorKind|errorType|failurePhase|firstCharacterClass|gatewayServer|htmlMarker|kind|lastCharacterClass|mediaType|method|nodeVersion|operation|outcome|phase|platform|procedure|reason|resultKind|rpcEndpoint|runtime|runtimeType|server|serverName|serverVersion|side|status|timestamp|toolName|transport|trpcCode|type|via)$/;
const SAFE_IDENTIFIER_KEY_PATTERN =
  /(?:batchId|continuationId|diagnosticId|spanId|Fingerprint|Hash|keyHashes)$/;
const SAFE_ERROR_CODE_KEY_PATTERN = /^(?:code|errorCode|trpcCode)$/;
const SAFE_ERROR_CODE_VALUE_PATTERN = /^(?:[A-Z][\dA-Z_]{1,63}|\d{3})$/;
const CREDENTIAL_SHAPED_VALUE_PATTERN =
  /^bearer\s+|^basic\s+|^sk[_-]|^pk[_-]|eyj[\w-]{8,}\.|(?:token|secret|password|api[_-]?key|cookie|credential)\s*[:=]|[\w+/=-]{48,}/i;

const TOOL_DEBUG_MAX_ARRAY = 10;
const TOOL_DEBUG_MAX_DEPTH = 6;
const TOOL_DEBUG_MAX_PROPERTIES = 50;
const TOOL_DEBUG_MAX_RECORD_BYTES = 16 * 1024;
export const TOOL_DEBUG_FINGERPRINT_BYTES = 256 * 1024;

export type ToolsDebugEvent =
  | 'assistant_finalization_rpc_complete'
  | 'assistant_finalization_rpc_failed'
  | 'assistant_finalization_rpc_handler_error'
  | 'assistant_finalization_rpc_started'
  | 'call_tool'
  | 'call_tool_complete'
  | 'call_tool_error'
  | 'call_tool_failed'
  | 'call_tool_normalized'
  | 'call_tool_result'
  | 'call_tool_started'
  | 'call_tool_upstream_complete'
  | 'client_cache_evicted'
  | 'client_cache_lookup'
  | 'client_disconnect_complete'
  | 'client_disconnect_failed'
  | 'client_initialization_failed'
  | 'client_initialization_progress'
  | 'client_initialization_started'
  | 'client_initialized'
  | 'client_rpc_response_failed'
  | 'list_prompts'
  | 'list_prompts_complete'
  | 'list_prompts_error'
  | 'list_prompts_failed'
  | 'list_resources'
  | 'list_resources_complete'
  | 'list_resources_error'
  | 'list_resources_failed'
  | 'list_tools'
  | 'list_tools_complete'
  | 'list_tools_error'
  | 'list_tools_failed'
  | 'mcp_operation_complete'
  | 'mcp_operation_failed'
  | 'mcp_operation_started'
  | 'oauth_operation_complete'
  | 'oauth_operation_failed'
  | 'oauth_operation_retry'
  | 'oauth_operation_started'
  | 'runtime_initialized'
  | 'tool_batch_settled'
  | 'tool_batch_started'
  | 'tools_rpc_complete'
  | 'tools_rpc_failed'
  | 'tools_rpc_handler_error'
  | 'tools_rpc_started'
  | 'tool_persistence_rpc_complete'
  | 'tool_persistence_rpc_failed'
  | 'tool_persistence_rpc_handler_error'
  | 'tool_persistence_rpc_started'
  | 'tool_completion_reported'
  | 'tool_result_persistence_complete'
  | 'tool_result_persistence_failed'
  | 'tool_result_persistence_started'
  | 'transport_request_complete'
  | 'transport_request_failed'
  | 'transport_request_retry'
  | 'transport_request_started'
  | 'transport_response_rejected';

export interface ToolsDebugContext {
  connectionHash?: string;
  diagnosticId?: string;
  operation?: string;
  runtime?: string;
  toolName?: string;
  transport?: string;
}

interface ToolsDebugStore extends ToolsDebugContext {
  sequence: { value: number };
  spanId: string;
  startedAt: number;
}

export interface ToolsDebugErrorMetadata {
  aborted?: boolean;
  causeDepth: number;
  code?: number | string;
  errorClass: string;
  errorFingerprint?: string;
  messageLength?: number;
  timedOut?: boolean;
}

const toolsDebugContext = new AsyncLocalStorage<ToolsDebugStore>();
let runtimeInitializedLogged = false;

const byteLength = (value: string) => Buffer.byteLength(value, 'utf8');

const replaceControlCharacters = (value: string) =>
  [...value]
    .map((character) => {
      const code = character.codePointAt(0) || 0;
      return code <= 31 || code === 127 ? ' ' : character;
    })
    .join('');

export const fingerprintString = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 16);

export const fingerprintToolsDebugBytes = (value: Uint8Array) =>
  createHash('sha256')
    .update(value.subarray(0, TOOL_DEBUG_FINGERPRINT_BYTES))
    .digest('hex')
    .slice(0, 16);

export const fingerprintToolsDebugString = (value: string) =>
  fingerprintToolsDebugBytes(Buffer.from(value, 'utf8'));

const canonicalizeDebugValue = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return typeof value;
  if (depth >= TOOL_DEBUG_MAX_DEPTH) return '[max-depth]';
  if (Array.isArray(value)) {
    return value
      .slice(0, TOOL_DEBUG_MAX_ARRAY)
      .map((item) => canonicalizeDebugValue(item, depth + 1));
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => !SECRET_KEY_PATTERN.test(key))
      .sort()
      .slice(0, TOOL_DEBUG_MAX_PROPERTIES)
      .map((key) => [key, canonicalizeDebugValue(record[key], depth + 1)]),
  );
};

export const fingerprintToolsDebugValue = (value: unknown) => {
  try {
    return fingerprintString(JSON.stringify(canonicalizeDebugValue(value)));
  } catch {
    return 'unavailable';
  }
};

const fingerprintDebugIdentifier = (value: unknown) => ({
  hash: fingerprintToolsDebugValue(value),
  type: 'identifier' as const,
});

export const createToolsDiagnosticId = () => `td_${randomUUID().replaceAll('-', '').slice(0, 20)}`;

export const getToolsDebugContext = (): Readonly<ToolsDebugContext> | undefined =>
  toolsDebugContext.getStore();

export const runWithToolsDebugContext = <T>(context: ToolsDebugContext, callback: () => T): T => {
  const parent = toolsDebugContext.getStore();
  const store: ToolsDebugStore = {
    ...parent,
    ...context,
    diagnosticId: context.diagnosticId || parent?.diagnosticId || createToolsDiagnosticId(),
    sequence: parent?.sequence || { value: 0 },
    spanId: parent?.spanId || `ts_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    startedAt: parent?.startedAt || Date.now(),
  };

  return toolsDebugContext.run(store, callback);
};

export const isToolsDebugEnabled = (
  minimumLevel: Exclude<ToolsDebugLevel, 'off'> = 'safe',
): boolean => {
  const level = parseToolsDebugLevel(process.env.CHATHUB_TOOLS_DEBUG);
  const structuredEnabled = level === 'verbose' || (level === 'safe' && minimumLevel === 'safe');
  const legacyEnabled =
    minimumLevel === 'verbose' ? verboseLegacyLog.enabled : safeLegacyLog.enabled;
  return !!(structuredEnabled || legacyEnabled);
};

const sanitizeDebugLabel = (value: string): string | { hash: string; length: number } => {
  const normalized = replaceControlCharacters(value).trim().slice(0, 160);
  if (!normalized || CREDENTIAL_SHAPED_VALUE_PATTERN.test(normalized)) {
    return { hash: fingerprintString(value), length: value.length };
  }
  return normalized;
};

const fingerprintDebugString = (value: string) => ({
  hash: fingerprintString(value),
  length: value.length,
  type: 'string' as const,
});

/**
 * Produce a bounded fingerprint view of a tool payload. Secret-keyed values are
 * omitted completely. Other strings become length + hash metadata, so prompts,
 * arguments, results, scraped content, and credentials cannot be emitted.
 */
export const sanitizeToolDebugPayload = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return fingerprintDebugString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    return { type: typeof value };
  }
  if (typeof value !== 'object') return { type: typeof value };
  if (depth >= TOOL_DEBUG_MAX_DEPTH) return '[truncated:max-depth]';

  if (Array.isArray(value)) {
    const items = value
      .slice(0, TOOL_DEBUG_MAX_ARRAY)
      .map((item) => sanitizeToolDebugPayload(item, depth + 1));
    return {
      itemCount: value.length,
      items,
      omittedItems: Math.max(0, value.length - TOOL_DEBUG_MAX_ARRAY),
      type: 'array',
    };
  }

  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  const entries = keys
    .filter((key) => !SECRET_KEY_PATTERN.test(key))
    .slice(0, TOOL_DEBUG_MAX_PROPERTIES)
    .map((key) => {
      try {
        const propertyValue = source[key];
        return {
          key: fingerprintDebugString(key),
          value: PRIVATE_IDENTIFIER_KEY_PATTERN.test(key)
            ? fingerprintDebugIdentifier(propertyValue)
            : sanitizeToolDebugPayload(propertyValue, depth + 1),
        };
      } catch {
        return {
          key: fingerprintDebugString(key),
          value: { type: 'unavailable' },
        };
      }
    });

  return {
    entries,
    omittedProperties: Math.max(0, keys.length - entries.length),
    propertyCount: keys.length,
    type: 'object',
  };
};

export const summarizeToolsDebugValue = (value: unknown) => {
  if (!isToolsDebugEnabled()) return undefined;

  const summary: Record<string, unknown> = { type: value === null ? 'null' : typeof value };

  try {
    if (typeof value === 'string') {
      summary.byteLength = byteLength(value);
      summary.contentFingerprint = fingerprintToolsDebugString(value);
      summary.isJson = (() => {
        try {
          JSON.parse(value);
          return true;
        } catch {
          return false;
        }
      })();
      summary.length = value.length;
      return summary;
    }
    if (Array.isArray(value)) {
      summary.itemCount = value.length;
      summary.valueFingerprint = fingerprintToolsDebugValue(value);
    } else if (value && typeof value === 'object') {
      const keys = Object.keys(value as Record<string, unknown>);
      summary.propertyCount = keys.length;
      summary.keyHashes = keys
        .filter((key) => !SECRET_KEY_PATTERN.test(key))
        .slice(0, TOOL_DEBUG_MAX_PROPERTIES)
        .map(fingerprintString);
      summary.valueFingerprint = fingerprintToolsDebugValue(value);
    }

    const serialized = JSON.stringify(value);
    if (serialized !== undefined) summary.byteLength = byteLength(serialized);
  } catch {
    summary.unavailable = true;
  }

  return summary;
};

export const describeToolsDebugError = (error: unknown): ToolsDebugErrorMetadata => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  let causeDepth = 0;
  let message = '';
  let code: number | string | undefined;
  let errorClass = typeof error;

  while (current && causeDepth < 5 && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      if (causeDepth === 0) {
        const sanitizedClass = sanitizeDebugLabel(current.name || 'Error');
        errorClass = typeof sanitizedClass === 'string' ? sanitizedClass : 'RedactedError';
        message = current.message || '';
        const candidateCode = (current as Error & { code?: unknown }).code;
        if (typeof candidateCode === 'string' || typeof candidateCode === 'number') {
          code = candidateCode;
        }
      }
      current = current.cause;
    } else if (typeof current === 'object') {
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
    causeDepth += 1;
  }

  const normalizedMessage = message.toLowerCase();
  return {
    aborted:
      errorClass === 'AbortError' ||
      normalizedMessage.includes('user aborted') ||
      normalizedMessage === 'aborterror',
    causeDepth,
    code,
    errorClass,
    errorFingerprint: message ? fingerprintToolsDebugString(message) : undefined,
    messageLength: message ? message.length : undefined,
    timedOut: normalizedMessage.includes('timeout') || normalizedMessage.includes('timed out'),
  };
};

export const sanitizeSafeRecord = (value: unknown, key = '', depth = 0): unknown => {
  if (value === null || value === undefined) return value;
  if (SECRET_KEY_PATTERN.test(key) && !SAFE_SECRET_METADATA_KEY_PATTERN.test(key)) return undefined;
  if (PRIVATE_IDENTIFIER_KEY_PATTERN.test(key)) return fingerprintDebugIdentifier(value);
  if (typeof value === 'string') {
    if (SAFE_ERROR_CODE_KEY_PATTERN.test(key) && !SAFE_ERROR_CODE_VALUE_PATTERN.test(value)) {
      return fingerprintDebugString(value);
    }
    if (SAFE_LABEL_KEY_PATTERN.test(key) || SAFE_IDENTIFIER_KEY_PATTERN.test(key)) {
      return sanitizeDebugLabel(value);
    }
    return fingerprintDebugString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return { type: typeof value };
  if (depth >= TOOL_DEBUG_MAX_DEPTH) return '[truncated:max-depth]';
  if (Array.isArray(value)) {
    return value.slice(0, TOOL_DEBUG_MAX_ARRAY).map((item) => {
      if (typeof item === 'string' && /^(?:headerNames|procedures)$/.test(key)) {
        return sanitizeDebugLabel(item);
      }
      return sanitizeSafeRecord(item, key, depth + 1);
    });
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .slice(0, TOOL_DEBUG_MAX_PROPERTIES)
    .flatMap(([childKey, childValue]) => {
      const sanitized = sanitizeSafeRecord(childValue, childKey, depth + 1);
      return sanitized === undefined ? [] : [[childKey, sanitized] as const];
    });
  return Object.fromEntries(entries);
};

const isStructuredLevelEnabled = (
  configuredLevel: ToolsDebugLevel,
  eventLevel: Exclude<ToolsDebugLevel, 'off'>,
) => configuredLevel === 'verbose' || (configuredLevel === 'safe' && eventLevel === 'safe');

const buildStructuredRecord = (
  debugLevel: Exclude<ToolsDebugLevel, 'off'>,
  fields: Record<string, unknown>,
) => {
  const context = toolsDebugContext.getStore();
  const sequence = context ? ++context.sequence.value : undefined;
  const common = context
    ? {
        connectionHash: context.connectionHash,
        diagnosticId: context.diagnosticId,
        elapsedMs: Date.now() - context.startedAt,
        eventSequence: sequence,
        operation: context.operation,
        runtime: context.runtime,
        spanId: context.spanId,
        toolName: context.toolName,
        transport: context.transport,
      }
    : {};

  return sanitizeSafeRecord({
    debugLevel,
    schemaVersion: 2,
    timestamp: new Date().toISOString(),
    ...common,
    ...fields,
  }) as Record<string, unknown>;
};

const safelyBuildStructuredRecord = (
  debugLevel: Exclude<ToolsDebugLevel, 'off'>,
  fields: Record<string, unknown>,
) => {
  try {
    return buildStructuredRecord(debugLevel, fields);
  } catch {
    return {
      debugLevel,
      recordSanitizationFailed: true,
      schemaVersion: 2,
      timestamp: new Date().toISOString(),
    };
  }
};

const writeStructuredRecord = (event: ToolsDebugEvent, record: Record<string, unknown>) => {
  const prefix = `[chathub-tools-debug:${event}]`;

  try {
    let json = JSON.stringify(record);
    const recordBytes = byteLength(json);
    if (recordBytes > TOOL_DEBUG_MAX_RECORD_BYTES) {
      json = JSON.stringify({
        debugLevel: record.debugLevel,
        diagnosticId: record.diagnosticId,
        eventSequence: record.eventSequence,
        originalRecordBytes: recordBytes,
        recordTruncated: true,
        schemaVersion: 2,
        spanId: record.spanId,
        timestamp: record.timestamp,
      });
    }
    // eslint-disable-next-line no-console
    console.log(prefix, json);
  } catch {
    try {
      // eslint-disable-next-line no-console
      console.log(
        prefix,
        JSON.stringify({
          debugLevel: record.debugLevel,
          schemaVersion: 2,
          serializationError: true,
        }),
      );
    } catch {
      // Diagnostics must never interrupt MCP behavior.
    }
  }
};

export const logToolsDebugRuntimeInitialized = (fields: Record<string, unknown> = {}) => {
  const configuredLevel = parseToolsDebugLevel(process.env.CHATHUB_TOOLS_DEBUG);
  if (runtimeInitializedLogged || !isStructuredLevelEnabled(configuredLevel, 'safe')) return;
  runtimeInitializedLogged = true;
  writeStructuredRecord(
    'runtime_initialized',
    safelyBuildStructuredRecord('safe', {
      appVersion: process.env.NEXT_PUBLIC_LOBE_CHAT_VERSION || 'unknown',
      architecture: process.arch,
      nodeVersion: process.version,
      platform: process.platform,
      processId: process.pid,
      ...fields,
    }),
  );
};

export const logToolsDebugSafe = (event: ToolsDebugEvent, fields: Record<string, unknown> = {}) => {
  const configuredLevel = parseToolsDebugLevel(process.env.CHATHUB_TOOLS_DEBUG);
  const structuredEnabled = isStructuredLevelEnabled(configuredLevel, 'safe');
  if (!structuredEnabled && !safeLegacyLog.enabled) return;
  const record = safelyBuildStructuredRecord('safe', fields);

  if (structuredEnabled) {
    writeStructuredRecord(event, record);
    return;
  }

  try {
    safeLegacyLog('event=%s payload=%O', event, record);
  } catch {
    // Diagnostics must never interrupt MCP behavior.
  }
};

export const logToolsDebugVerbose = (event: ToolsDebugEvent, payload: unknown) => {
  const configuredLevel = parseToolsDebugLevel(process.env.CHATHUB_TOOLS_DEBUG);
  const structuredEnabled = isStructuredLevelEnabled(configuredLevel, 'verbose');
  if (!structuredEnabled && !verboseLegacyLog.enabled) return;

  let sanitizedPayload: unknown;
  try {
    sanitizedPayload = sanitizeToolDebugPayload(payload);
  } catch {
    sanitizedPayload = { type: 'unavailable' };
  }

  const record = safelyBuildStructuredRecord('verbose', { payload: sanitizedPayload });

  if (structuredEnabled) {
    writeStructuredRecord(event, record);
    return;
  }

  try {
    verboseLegacyLog('event=%s payload=%O', event, record);
  } catch {
    // Diagnostics must never interrupt MCP behavior.
  }
};
