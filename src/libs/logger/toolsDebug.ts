import debug from 'debug';
import { createHash } from 'node:crypto';

import {
  parseToolsDebugLevel,
  TOOLS_SAFE_NS,
  TOOLS_VERBOSE_NS,
  type ToolsDebugLevel,
} from './bootstrap';

const safeLegacyLog = debug(TOOLS_SAFE_NS[0]);
const verboseLegacyLog = debug(TOOLS_VERBOSE_NS[0]);

const SECRET_KEY_PATTERN = /token|secret|password|api[_-]?key|authorization|cookie/i;
const TOOL_DEBUG_MAX_ARRAY = 3;
const TOOL_DEBUG_MAX_DEPTH = 4;
const TOOL_DEBUG_MAX_PROPERTIES = 20;

type SafeToolsDebugEventPayloads = {
  call_tool_complete: { durationMs: number };
  call_tool_failed: { durationMs: number };
  client_cache_hit: { transport: string };
  client_initialization_failed: { transport: string };
  client_initialized: { transport: string };
  list_tools_complete: { count: number; durationMs: number };
  list_tools_failed: { durationMs: number };
};

type VerboseToolsDebugEvent =
  | 'call_tool'
  | 'call_tool_error'
  | 'call_tool_result'
  | 'list_prompts'
  | 'list_prompts_error'
  | 'list_resources'
  | 'list_resources_error'
  | 'list_tools'
  | 'list_tools_error';

const fingerprintDebugString = (value: string) => ({
  hash: createHash('sha256').update(value).digest('hex').slice(0, 16),
  length: value.length,
  type: 'string' as const,
});

/**
 * Produce a bounded fingerprint view of a tool payload. Every non-secret
 * string becomes length + hash metadata, so verbose diagnostics cannot emit
 * raw prompts, arguments, results, scraped content, or credentials.
 */
export const sanitizeToolDebugPayload = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return fingerprintDebugString(value);

  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    return { type: typeof value };
  }

  if (typeof value !== 'object') return value;

  if (depth >= TOOL_DEBUG_MAX_DEPTH) return '[truncated:max-depth]';

  if (Array.isArray(value)) {
    const items = value
      .slice(0, TOOL_DEBUG_MAX_ARRAY)
      .map((item) => sanitizeToolDebugPayload(item, depth + 1));
    return value.length > TOOL_DEBUG_MAX_ARRAY
      ? [...items, `(+${value.length - TOOL_DEBUG_MAX_ARRAY} more)`]
      : items;
  }

  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  const entries = keys.slice(0, TOOL_DEBUG_MAX_PROPERTIES).map((key) => {
    const secret = SECRET_KEY_PATTERN.test(key);
    let sanitizedValue: unknown = '[redacted]';

    if (!secret) {
      try {
        sanitizedValue = sanitizeToolDebugPayload(source[key], depth + 1);
      } catch {
        sanitizedValue = { type: 'unavailable' };
      }
    }

    return {
      key: fingerprintDebugString(key),
      secret,
      value: sanitizedValue,
    };
  });

  return {
    entries,
    omittedProperties: Math.max(0, keys.length - TOOL_DEBUG_MAX_PROPERTIES),
    propertyCount: keys.length,
    type: 'object',
  };
};

const isStructuredLevelEnabled = (
  configuredLevel: ToolsDebugLevel,
  eventLevel: Exclude<ToolsDebugLevel, 'off'>,
) =>
  configuredLevel === 'verbose' ||
  (configuredLevel === 'safe' && eventLevel === 'safe');

const writeStructuredRecord = (
  event: keyof SafeToolsDebugEventPayloads | VerboseToolsDebugEvent,
  record: Record<string, unknown>,
) => {
  const prefix = `[chathub-tools-debug:${event}]`;

  try {
    // Match the prefixed-JSON shape used by DEBUG_OPENAICOMPATIBLE_CACHE so
    // production ingestion can populate debug_namespace and debug_event.
    // eslint-disable-next-line no-console
    console.log(prefix, JSON.stringify(record));
  } catch {
    try {
      // Diagnostics must never interrupt an MCP operation.
      // eslint-disable-next-line no-console
      console.log(
        prefix,
        JSON.stringify({ debugLevel: record.debugLevel, serializationError: true }),
      );
    } catch {
      // Ignore output failures: tool behavior must not depend on diagnostics.
    }
  }
};

export const logToolsDebugSafe = <Event extends keyof SafeToolsDebugEventPayloads>(
  event: Event,
  fields: SafeToolsDebugEventPayloads[Event],
) => {
  const record = { debugLevel: 'safe', ...fields };
  const configuredLevel = parseToolsDebugLevel(process.env.CHATHUB_TOOLS_DEBUG);

  if (isStructuredLevelEnabled(configuredLevel, 'safe')) {
    writeStructuredRecord(event, record);
    return;
  }

  try {
    safeLegacyLog('event=%s payload=%O', event, record);
  } catch {
    // Ignore output failures: tool behavior must not depend on diagnostics.
  }
};

export const logToolsDebugVerbose = (event: VerboseToolsDebugEvent, payload: unknown) => {
  let sanitizedPayload: unknown;

  try {
    sanitizedPayload = sanitizeToolDebugPayload(payload);
  } catch {
    sanitizedPayload = { type: 'unavailable' };
  }

  const record = {
    debugLevel: 'verbose',
    payload: sanitizedPayload,
  };
  const configuredLevel = parseToolsDebugLevel(process.env.CHATHUB_TOOLS_DEBUG);

  if (isStructuredLevelEnabled(configuredLevel, 'verbose')) {
    writeStructuredRecord(event, record);
    return;
  }

  try {
    verboseLegacyLog('event=%s payload=%O', event, record);
  } catch {
    // Ignore output failures: tool behavior must not depend on diagnostics.
  }
};
