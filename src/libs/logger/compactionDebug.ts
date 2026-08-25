import { ModelProvider } from 'model-bank';
import { z } from 'zod';

import { parseCompactionDebugLevel } from './bootstrap';
import { fingerprintString, sanitizeSafeRecord } from './toolsDebug';

/**
 * CHATHUB_COMPACTION_DEBUG is a single switch for structured diagnostics of
 * topic compaction: why a run started or was skipped (token-threshold vs
 * message-count / scheduled / manual), the estimated request-token breakdown,
 * and which context-window number was used. It does not change compaction
 * behavior. Value semantics match CHATHUB_TOOLS_DEBUG:
 *
 * - unset / empty / 0 / false / off  → off
 * - 1 / true / on / safe             → safe metadata records
 * - verbose / 2                      → same records plus flag booleans
 *
 * Records use the prefixed-JSON line format `[chathub-compaction-debug:<event>]
 * {json}` so Axiom auto-promotes `debug_namespace` and `debug_event`.
 *
 * Sanitization is identical to chathub-tools-debug for shared keys: summary
 * text and message content are never emitted, identifiers are sha256-16
 * fingerprints, and only counts, ratios, built-in model-bank IDs, trusted
 * `ModelProvider` ids, and validated compaction enums stay readable. Custom
 * or unlisted model IDs and unknown provider slugs are fingerprinted.
 * Compaction-only labels (`path`, `trigger`) are NOT added to the global
 * safe-label list; they are overlaid after `sanitizeSafeRecord` from
 * event-specific Zod enums. `provider` is also overlaid from the built-in
 * provider allowlist rather than the global readable-label regex. Client
 * fields are re-parsed and re-sanitized server-side because they arrive from
 * an untrusted origin. Canonical `debugLevel`, `schemaVersion`, `side`, and
 * `timestamp` are always written by the emitter and cannot be overridden by
 * caller fields.
 */

const COMPACTION_DEBUG_MAX_RECORD_BYTES = 16 * 1024;

const COMPACTION_VERBOSE_ONLY_KEYS = new Set([
  'enableCompressHistory',
  'enableHistoryCount',
  'enableTokenThresholdAutoCompact',
  'enableUserMemoryArchive',
  'targetReachable',
  'truncatedForPreSend',
]);

const COMPACTION_DEBUG_RESERVED_KEYS = new Set([
  'debugLevel',
  'schemaVersion',
  'side',
  'timestamp',
]);

const COMPACTION_DEBUG_ENUM_KEYS = ['outcome', 'path', 'reason', 'status', 'trigger'] as const;

const TRUSTED_COMPACTION_PROVIDERS = new Set<string>(Object.values(ModelProvider));

export const COMPACTION_DEBUG_CLIENT_EVENTS = ['planner_settled', 'watcher_armed'] as const;

export const COMPACTION_DEBUG_PATHS = ['client_inline', 'durable_enqueued', 'pre_send'] as const;

export const COMPACTION_DEBUG_TRIGGERS = [
  'manual',
  'message_count',
  'scheduled',
  'token_threshold',
] as const;

export const COMPACTION_DEBUG_STATUSES = [
  'compacted',
  'failed',
  'ineligible',
  'not_needed',
  'target_unreachable',
] as const;

export const COMPACTION_DEBUG_OUTCOMES = [
  'cancelled',
  'failed',
  'interrupted',
  'succeeded',
] as const;

export const COMPACTION_DEBUG_REASONS = [
  'aborted',
  'below_high_watermark',
  'compaction_exception',
  'conversation_changed',
  'durable_enqueued',
  'empty_or_failed_summary',
  'generation_in_progress',
  'history_compaction_is_disabled',
  'no_active_topic',
  'no_settled_turn_available',
  'protected_context_exceeds_low_watermark',
  'stale_request',
  'threads_and_groups_are_not_supported',
  'token_auto_compaction_is_disabled',
  'topic_not_loaded',
  'unknown_context_window',
] as const;

export type CompactionDebugEvent =
  | (typeof COMPACTION_DEBUG_CLIENT_EVENTS)[number]
  | 'worker_settled';

export type CompactionDebugSide = 'client' | 'server';

export const COMPACTION_DEBUG_NAMESPACE = 'chathub-compaction-debug';

const optionalBoolean = z.preprocess(
  (value) => (typeof value === 'boolean' ? value : undefined),
  z.boolean().optional(),
);
const optionalFiniteNumber = z.preprocess(
  (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined),
  z.number().optional(),
);
const optionalMatchingString = (pattern: RegExp, maxLength = 160) =>
  z.preprocess((value) => {
    if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) {
      return undefined;
    }
    return pattern.test(value) ? value : undefined;
  }, z.string().optional());
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && (values as readonly string[]).includes(value) ? value : undefined,
    z.enum(values as unknown as [T[number], ...T[number][]]).optional(),
  );

const optionalModel = z.preprocess((value) => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160) return undefined;
  return value;
}, z.string().optional());
const optionalProvider = optionalMatchingString(/^[\da-z][\da-z-]{0,31}$/, 32);
const optionalHash = optionalMatchingString(/^(?:[\da-f]{16}|fnv[\da-f]{8})$/);
const optionalSpanId = optionalMatchingString(/^cd_[\da-f]{16}$/, 19);

const plannerSettledFieldsSchema = z
  .object({
    candidateCount: optionalFiniteNumber,
    chatsToken: optionalFiniteNumber,
    enableCompressHistory: optionalBoolean,
    enableHistoryCount: optionalBoolean,
    enableTokenThresholdAutoCompact: optionalBoolean,
    enableUserMemoryArchive: optionalBoolean,
    highWatermark: optionalFiniteNumber,
    historyCount: optionalFiniteNumber,
    historySummaryToken: optionalFiniteNumber,
    inputToken: optionalFiniteNumber,
    lowWatermark: optionalFiniteNumber,
    maxTokens: optionalFiniteNumber,
    memoryToken: optionalFiniteNumber,
    model: optionalModel,
    path: optionalEnum(COMPACTION_DEBUG_PATHS),
    provider: optionalProvider,
    ratio: optionalFiniteNumber,
    reason: optionalEnum(COMPACTION_DEBUG_REASONS),
    sessionHash: optionalHash,
    slicedMessageCount: optionalFiniteNumber,
    spanId: optionalSpanId,
    status: optionalEnum(COMPACTION_DEBUG_STATUSES),
    systemRoleToken: optionalFiniteNumber,
    targetReachable: optionalBoolean,
    toolsToken: optionalFiniteNumber,
    topicHash: optionalHash,
    topicMessageCount: optionalFiniteNumber,
    totalToken: optionalFiniteNumber,
    trigger: optionalEnum(COMPACTION_DEBUG_TRIGGERS),
    truncatedForPreSend: optionalBoolean,
  })
  .strip();

const watcherArmedFieldsSchema = z
  .object({
    highWatermark: optionalFiniteNumber,
    knowledgeBaseToken: optionalFiniteNumber,
    maxTokens: optionalFiniteNumber,
    ratio: optionalFiniteNumber,
    sessionHash: optionalHash,
    topicHash: optionalHash,
    totalToken: optionalFiniteNumber,
  })
  .strip();

const workerSettledFieldsSchema = z
  .object({
    candidateCount: optionalFiniteNumber,
    contentChars: optionalFiniteNumber,
    model: optionalModel,
    outcome: optionalEnum(COMPACTION_DEBUG_OUTCOMES),
    provider: optionalProvider,
    reasoningChars: optionalFiniteNumber,
    spanId: optionalSpanId,
    trigger: optionalEnum(COMPACTION_DEBUG_TRIGGERS),
  })
  .strip();

export const compactionDebugClientEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('planner_settled'),
    fields: plannerSettledFieldsSchema.optional(),
  }),
  z.object({
    event: z.literal('watcher_armed'),
    fields: watcherArmedFieldsSchema.optional(),
  }),
]);

const EVENT_FIELD_SCHEMAS = {
  planner_settled: plannerSettledFieldsSchema,
  watcher_armed: watcherArmedFieldsSchema,
  worker_settled: workerSettledFieldsSchema,
} as const;

export const getCompactionDebugLevel = () =>
  parseCompactionDebugLevel(process.env.CHATHUB_COMPACTION_DEBUG);

export const isCompactionDebugEnabled = (): boolean => getCompactionDebugLevel() !== 'off';

/** sha256-16 fingerprint for identifiers. */
export const hashCompactionDebugValue = (value: string): string => fingerprintString(value);

const compactDefinedFields = (fields: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) => value !== undefined && !COMPACTION_DEBUG_RESERVED_KEYS.has(key),
    ),
  );

export const parseCompactionDebugFields = (
  event: CompactionDebugEvent,
  fields: Record<string, unknown> = {},
): Record<string, unknown> => {
  const parsed = EVENT_FIELD_SCHEMAS[event].safeParse(fields);
  if (!parsed.success || !parsed.data || typeof parsed.data !== 'object') return {};
  return compactDefinedFields(parsed.data as Record<string, unknown>);
};

const omitVerboseOnlyFields = (
  fields: Record<string, unknown>,
  debugLevel: 'safe' | 'verbose',
): Record<string, unknown> => {
  if (debugLevel === 'verbose') return fields;
  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => !COMPACTION_VERBOSE_ONLY_KEYS.has(key)),
  );
};

const splitCompactionEnumFields = (fields: Record<string, unknown>) => {
  const enums: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if ((COMPACTION_DEBUG_ENUM_KEYS as readonly string[]).includes(key)) {
      enums[key] = value;
    } else {
      rest[key] = value;
    }
  }
  return { enums, rest };
};

const sanitizeCompactionProviderField = (provider: unknown): Record<string, unknown> => {
  if (typeof provider !== 'string' || provider.length === 0) return {};
  if (TRUSTED_COMPACTION_PROVIDERS.has(provider)) return { provider };
  return {
    provider: {
      hash: fingerprintString(provider),
      length: provider.length,
      type: 'string',
    },
  };
};

export const logCompactionDebugSafe = (
  event: CompactionDebugEvent,
  fields: Record<string, unknown> = {},
  options?: { side?: CompactionDebugSide },
) => {
  const debugLevel = getCompactionDebugLevel();
  if (debugLevel === 'off') return;

  const side: CompactionDebugSide = options?.side === 'client' ? 'client' : 'server';
  let record: Record<string, unknown>;
  try {
    const { enums, rest } = splitCompactionEnumFields(
      omitVerboseOnlyFields(parseCompactionDebugFields(event, fields), debugLevel),
    );
    const { provider, ...restWithoutProvider } = rest;
    record = {
      ...(sanitizeSafeRecord(restWithoutProvider) as Record<string, unknown>),
      ...enums,
      ...sanitizeCompactionProviderField(provider),
      debugLevel,
      schemaVersion: 1,
      side,
      timestamp: new Date().toISOString(),
    };
  } catch {
    record = {
      debugLevel: 'safe',
      recordSanitizationFailed: true,
      schemaVersion: 1,
      side,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    let json = JSON.stringify(record);
    const recordBytes = Buffer.byteLength(json, 'utf8');
    if (recordBytes > COMPACTION_DEBUG_MAX_RECORD_BYTES) {
      json = JSON.stringify({
        debugLevel: 'safe',
        originalRecordBytes: recordBytes,
        recordTruncated: true,
        schemaVersion: 1,
        side,
        spanId: record.spanId,
        timestamp: record.timestamp,
      });
    }
    // eslint-disable-next-line no-console
    console.log(`[${COMPACTION_DEBUG_NAMESPACE}:${event}]`, json);
  } catch {
    // Diagnostics must never interrupt topic compaction.
  }
};
