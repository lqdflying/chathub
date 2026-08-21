import { parseToolsDebugLevel } from './bootstrap';
import { fingerprintString, sanitizeSafeRecord } from './toolsDebug';

/**
 * CHATHUB_GENERATION_DEBUG is a single switch for structured diagnostics of
 * the durable conversation-generation send path: client send/attach/sync
 * decisions (re-emitted by the server through `reportClientDebug`) and
 * server enqueue/worker internals. Value semantics match CHATHUB_TOOLS_DEBUG:
 *
 * - unset / empty / 0 / false / off  → off
 * - 1 / true / on / safe             → safe metadata records
 * - verbose / 2                      → same records (no extra payload today)
 *
 * Records use the prefixed-JSON line format `[chathub-generation-debug:<event>]
 * {json}` so Axiom auto-promotes `debug_namespace` and `debug_event`.
 *
 * Sanitization is identical to chathub-tools-debug: message content is never
 * emitted, identifiers are sha256-16 fingerprints, and only error classes,
 * tRPC codes, counts, and ages are recorded. Client-reported fields are
 * re-sanitized server-side because they arrive from an untrusted origin.
 */

const GENERATION_DEBUG_MAX_RECORD_BYTES = 16 * 1024;

export const GENERATION_DEBUG_CLIENT_EVENTS = [
  'browser_path_started',
  'builtin_tool_settled',
  'deferred_lane_aborted',
  'deferred_lane_left',
  'deferred_lane_marked',
  'deferred_lane_resumed',
  'deferred_placeholder_finalized',
  'durable_attach',
  'durable_attach_skipped',
  'enqueue_client_settled',
  'event_applied_terminal',
  'event_dropped',
  'exec_runtime_settled',
  'orphan_deleted',
  'regenerate_early_return',
  'regenerate_enqueue_settled',
  'regenerate_started',
  'send_failure_ui',
  'send_recovery',
  'send_rpc_settled',
  'send_started',
  'sse_client_poll_failed',
  'sse_client_reset_replay',
  'sse_client_stream_ended',
  'sse_client_stream_failed',
  'sync_summary',
  'topic_busy_changed',
] as const;

export type GenerationDebugEvent =
  // Client-side events, re-emitted by reportClientDebug with side:'client'.
  | (typeof GENERATION_DEBUG_CLIENT_EVENTS)[number]
  // Server-side events.
  | 'enqueue_persisted'
  | 'enqueue_received'
  | 'enqueue_rejected'
  | 'execute_retrying'
  | 'execute_settled'
  | 'execute_skipped'
  | 'execute_started'
  | 'execute_transcript_loaded'
  | 'job_malformed'
  | 'job_received'
  | 'sse_closed'
  | 'sse_opened'
  | 'sse_poll_failed'
  | 'sse_reset'
  | 'sweep_failed'
  | 'sweep_reenqueued'
  | 'worker_start_failed'
  | 'worker_started'
  | 'worker_stopped';

export const GENERATION_DEBUG_NAMESPACE = 'chathub-generation-debug';

export const isGenerationDebugEnabled = (): boolean =>
  parseToolsDebugLevel(process.env.CHATHUB_GENERATION_DEBUG) !== 'off';

/** sha256-16 fingerprint for identifiers and message content hashes. */
export const hashGenerationDebugValue = (value: string): string => fingerprintString(value);

export const logGenerationDebugSafe = (
  event: GenerationDebugEvent,
  fields: Record<string, unknown> = {},
) => {
  if (!isGenerationDebugEnabled()) return;

  let record: Record<string, unknown>;
  try {
    record = sanitizeSafeRecord({
      debugLevel: 'safe',
      schemaVersion: 1,
      side: 'server',
      timestamp: new Date().toISOString(),
      ...fields,
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
    if (recordBytes > GENERATION_DEBUG_MAX_RECORD_BYTES) {
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
    console.log(`[${GENERATION_DEBUG_NAMESPACE}:${event}]`, json);
  } catch {
    // Diagnostics must never interrupt conversation generation.
  }
};
