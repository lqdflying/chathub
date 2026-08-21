/**
 * Client-side emitter for CHATHUB_GENERATION_DEBUG send-path diagnostics.
 *
 * Events are queued and flushed fire-and-forget through the
 * `conversationGeneration.reportClientDebug` tRPC mutation (2 s or 20 events),
 * where the server re-sanitizes and re-emits them into the same
 * `[chathub-generation-debug:*]` log stream with `side:'client'`.
 *
 * Gating: `localStorage['chathub.generationDebug']` overrides everything
 * ('1'/'true'/'on' force-on, '0'/'false'/'off' force-off); otherwise the
 * server-provided `GlobalServerConfig.generationDebug` flag decides.
 *
 * Privacy: call sites must only pass metadata (hashed identifiers, counts,
 * error classes, tRPC codes, ages) — never message content. Fields are
 * additionally bounded here and re-sanitized server-side as untrusted input.
 */

export type GenerationDebugClientEvent =
  | 'browser_path_started'
  | 'builtin_tool_settled'
  | 'deferred_lane_aborted'
  | 'deferred_lane_left'
  | 'deferred_lane_marked'
  | 'deferred_lane_resumed'
  | 'deferred_placeholder_finalized'
  | 'durable_attach'
  | 'durable_attach_skipped'
  | 'enqueue_client_settled'
  | 'event_applied_terminal'
  | 'event_dropped'
  | 'exec_runtime_settled'
  | 'orphan_deleted'
  | 'regenerate_early_return'
  | 'regenerate_enqueue_settled'
  | 'regenerate_started'
  | 'send_failure_ui'
  | 'send_recovery'
  | 'send_rpc_settled'
  | 'send_started'
  | 'sse_client_poll_failed'
  | 'sse_client_reset_replay'
  | 'sse_client_stream_ended'
  | 'sse_client_stream_failed'
  | 'sync_summary'
  | 'topic_busy_changed';

export type TopicBusyFlags = {
  deferredLane: boolean;
  durableJob: boolean;
  producing: boolean;
  sendRpc: boolean;
  tools: boolean;
  topicCrud: boolean;
};

const CLIENT_DEBUG_STORAGE_KEY = 'chathub.generationDebug';
const CLIENT_DEBUG_MAX_EVENTS_PER_FLUSH = 20;
const CLIENT_DEBUG_FLUSH_INTERVAL_MS = 2000;
const CLIENT_DEBUG_MAX_PROPERTIES = 40;
const CLIENT_DEBUG_MAX_STRING_LENGTH = 300;
const CLIENT_DEBUG_OFF_VALUES = new Set(['0', 'false', 'off']);
const CLIENT_DEBUG_ON_VALUES = new Set(['1', 'true', 'on']);

interface QueuedGenerationDebugEvent {
  event: GenerationDebugClientEvent;
  fields?: Record<string, unknown>;
}

let queue: QueuedGenerationDebugEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let pageHideListenerRegistered = false;

const readStorageOverride = (): boolean | undefined => {
  try {
    if (typeof window === 'undefined') return undefined;
    const raw = window.localStorage.getItem(CLIENT_DEBUG_STORAGE_KEY)?.trim().toLowerCase();
    if (!raw) return undefined;
    if (CLIENT_DEBUG_ON_VALUES.has(raw)) return true;
    if (CLIENT_DEBUG_OFF_VALUES.has(raw)) return false;
    return undefined;
  } catch {
    return undefined;
  }
};

const readServerConfigFlag = (): boolean => {
  try {
    if (typeof window === 'undefined') return false;
    // The serverConfig store registers itself on window; reading it lazily
    // avoids an import cycle between libs/logger and the store.
    const store = (
      window as unknown as {
        global_serverConfigStore?: {
          getState: () => { serverConfig?: { generationDebug?: boolean } };
        };
      }
    ).global_serverConfigStore;
    return Boolean(store?.getState().serverConfig?.generationDebug);
  } catch {
    return false;
  }
};

export const isGenerationDebugClientEnabled = (): boolean => {
  const override = readStorageOverride();
  if (override !== undefined) return override;
  return readServerConfigFlag();
};

export const createGenerationDebugSpanId = (): string => {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `gd_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return `gd_${Date.now().toString(16)}${Math.floor(Math.random() * 0xffff_ffff).toString(16)}`;
  }
};

/**
 * sha256-16 fingerprint of an identifier or message content, matching the
 * server-side `hashGenerationDebugValue` so client and server hashes compare.
 */
export const hashGenerationDebugClientValue = async (value: string): Promise<string> => {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  } catch {
    // Non-cryptographic fallback; diagnostics only.
    let hash = 0x811c_9dc5;
    for (const character of value) {
      hash ^= character.codePointAt(0) || 0;
      hash = Math.imul(hash, 0x0100_0193) >>> 0;
    }
    return `fnv${hash.toString(16).padStart(8, '0')}`.slice(0, 16);
  }
};

const boundClientDebugValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value.length > CLIENT_DEBUG_MAX_STRING_LENGTH
      ? `${value.slice(0, CLIENT_DEBUG_MAX_STRING_LENGTH)}…`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === undefined) {
    return value;
  }
  try {
    const serialized = JSON.stringify(value);
    return boundClientDebugValue(serialized ?? String(value));
  } catch {
    return '[unserializable]';
  }
};

const boundClientDebugFields = (fields: Record<string, unknown> = {}): Record<string, unknown> => {
  const entries = Object.entries(fields)
    .slice(0, CLIENT_DEBUG_MAX_PROPERTIES)
    .map(([key, value]) => [key, boundClientDebugValue(value)] as const);
  return Object.fromEntries(entries);
};

export const flushGenerationDebugClient = () => {
  if (typeof window === 'undefined' || queue.length === 0) return;
  const events = queue;
  queue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }

  import('@/libs/trpc/client')
    .then(({ lambdaClient }) =>
      lambdaClient.conversationGeneration.reportClientDebug.mutate(
        { events },
        { context: { showNotification: false } },
      ),
    )
    .catch(() => {
      // Diagnostics must never interrupt the send path.
    });
};

export const logGenerationDebugClientSafe = (
  event: GenerationDebugClientEvent,
  fields: Record<string, unknown> = {},
) => {
  try {
    if (typeof window === 'undefined') return;
    if (!isGenerationDebugClientEnabled()) return;

    queue.push({ event, fields: boundClientDebugFields(fields) });
    if (queue.length >= CLIENT_DEBUG_MAX_EVENTS_PER_FLUSH) {
      flushGenerationDebugClient();
      return;
    }

    flushTimer ??= setTimeout(() => {
      flushTimer = undefined;
      flushGenerationDebugClient();
    }, CLIENT_DEBUG_FLUSH_INTERVAL_MS);

    if (!pageHideListenerRegistered) {
      pageHideListenerRegistered = true;
      window.addEventListener('pagehide', () => flushGenerationDebugClient(), { once: true });
    }
  } catch {
    // Diagnostics must never interrupt the send path.
  }
};

export type DeferredGenerationLaneDebugEvent =
  | 'builtin_tool_settled'
  | 'deferred_lane_aborted'
  | 'deferred_lane_left'
  | 'deferred_lane_marked'
  | 'deferred_lane_resumed'
  | 'deferred_placeholder_finalized';

const hashOptionalDebugValue = async (value?: string | null): Promise<string | undefined> => {
  if (!value) return undefined;
  return hashGenerationDebugClientValue(value);
};

/**
 * Hashes identifiers then emits a deferred-lane lifecycle record. Callers must
 * not pass raw session/topic/message ids in `fields`.
 */
export const logDeferredGenerationLane = async (
  event: DeferredGenerationLaneDebugEvent,
  input: {
    assistantMessageId: string;
    sessionId?: string | null;
    spanId?: string;
    threadId?: string | null;
    topicId?: string | null;
  } & Record<string, unknown>,
) => {
  try {
    const { assistantMessageId, sessionId, threadId, topicId, ...fields } = input;
    const [messageHash, sessionHash, topicHash, threadHash] = await Promise.all([
      hashGenerationDebugClientValue(assistantMessageId),
      hashOptionalDebugValue(sessionId),
      hashOptionalDebugValue(topicId),
      hashOptionalDebugValue(threadId),
    ]);
    logGenerationDebugClientSafe(event, {
      ...fields,
      messageHash,
      sessionHash,
      threadHash,
      topicHash,
    });
  } catch {
    // Diagnostics must never interrupt the send path.
  }
};

const lastTopicBusy = new Map<string, boolean>();

/** Test-only: drop remembered topic busy/idle transitions. */
export const resetTopicBusyDebugState = () => {
  lastTopicBusy.clear();
};

/**
 * Emit `topic_busy_changed` only when the topic list spinner would start or
 * stop. Initial idle observations are silent so mounting the list does not
 * flood Axiom.
 */
export const reportTopicBusyChanged = (
  topicId: string | null | undefined,
  busy: boolean,
  flags: TopicBusyFlags,
) => {
  try {
    const key = topicId ?? '__default__';
    const previous = lastTopicBusy.get(key);
    if (previous === undefined) {
      lastTopicBusy.set(key, busy);
      if (!busy) return;
    } else if (previous === busy) {
      return;
    } else {
      lastTopicBusy.set(key, busy);
    }

    void hashOptionalDebugValue(topicId).then((topicHash) => {
      logGenerationDebugClientSafe('topic_busy_changed', {
        ...flags,
        outcome: busy ? 'busy' : 'idle',
        topicHash,
      });
    });
  } catch {
    // Diagnostics must never interrupt the topic list.
  }
};
