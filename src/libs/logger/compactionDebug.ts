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
 * Sanitization is identical to chathub-tools-debug: summary text and message
 * content are never emitted, identifiers are sha256-16 fingerprints, and only
 * counts, ratios, allowlisted labels (`trigger`, `status`, `reason`, `path`,
 * `provider`), and built-in model-bank IDs stay readable. Custom or unlisted
 * model IDs are fingerprinted. Client-reported fields are re-sanitized
 * server-side because they arrive from an untrusted origin.
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

export const COMPACTION_DEBUG_CLIENT_EVENTS = ['planner_settled', 'watcher_armed'] as const;

export type CompactionDebugEvent =
  | (typeof COMPACTION_DEBUG_CLIENT_EVENTS)[number]
  | 'worker_settled';

export const COMPACTION_DEBUG_NAMESPACE = 'chathub-compaction-debug';

export const getCompactionDebugLevel = () =>
  parseCompactionDebugLevel(process.env.CHATHUB_COMPACTION_DEBUG);

export const isCompactionDebugEnabled = (): boolean => getCompactionDebugLevel() !== 'off';

/** sha256-16 fingerprint for identifiers. */
export const hashCompactionDebugValue = (value: string): string => fingerprintString(value);

const omitVerboseOnlyFields = (
  fields: Record<string, unknown>,
  debugLevel: 'safe' | 'verbose',
): Record<string, unknown> => {
  if (debugLevel === 'verbose') return fields;
  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => !COMPACTION_VERBOSE_ONLY_KEYS.has(key)),
  );
};

export const logCompactionDebugSafe = (
  event: CompactionDebugEvent,
  fields: Record<string, unknown> = {},
) => {
  const debugLevel = getCompactionDebugLevel();
  if (debugLevel === 'off') return;

  let record: Record<string, unknown>;
  try {
    record = sanitizeSafeRecord({
      debugLevel,
      schemaVersion: 1,
      side: 'server',
      timestamp: new Date().toISOString(),
      ...omitVerboseOnlyFields(fields, debugLevel),
    }) as Record<string, unknown>;
  } catch {
    record = {
      debugLevel: 'safe',
      recordSanitizationFailed: true,
      schemaVersion: 1,
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
