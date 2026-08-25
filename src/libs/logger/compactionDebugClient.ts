/**
 * Client-side emitter for CHATHUB_COMPACTION_DEBUG planner/watcher diagnostics.
 *
 * Events are queued and flushed fire-and-forget through the
 * `conversationGeneration.reportCompactionDebug` tRPC mutation (2 s or 20 events),
 * where the server re-sanitizes and re-emits them into the same
 * `[chathub-compaction-debug:*]` log stream with `side:'client'`.
 *
 * Gating: `localStorage['chathub.compactionDebug']` overrides everything
 * ('1'/'true'/'on' force-on, '0'/'false'/'off' force-off); otherwise the
 * server-provided `GlobalServerConfig.compactionDebug` flag decides.
 *
 * Privacy: call sites must only pass metadata (hashed identifiers, counts,
 * ratios, allowlisted labels) — never summary text or message content. Fields
 * are additionally bounded here and re-sanitized server-side as untrusted input.
 */

export type CompactionDebugClientEvent = 'planner_settled' | 'watcher_armed';

const CLIENT_DEBUG_STORAGE_KEY = 'chathub.compactionDebug';
const CLIENT_DEBUG_MAX_EVENTS_PER_FLUSH = 20;
const CLIENT_DEBUG_FLUSH_INTERVAL_MS = 2000;
const CLIENT_DEBUG_MAX_PROPERTIES = 40;
const CLIENT_DEBUG_MAX_STRING_LENGTH = 300;
const CLIENT_DEBUG_OFF_VALUES = new Set(['0', 'false', 'off']);
const CLIENT_DEBUG_ON_VALUES = new Set(['1', 'true', 'on']);

interface QueuedCompactionDebugEvent {
  event: CompactionDebugClientEvent;
  fields?: Record<string, unknown>;
}

let queue: QueuedCompactionDebugEvent[] = [];
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
    const store = (
      window as unknown as {
        global_serverConfigStore?: {
          getState: () => { serverConfig?: { compactionDebug?: boolean } };
        };
      }
    ).global_serverConfigStore;
    return Boolean(store?.getState().serverConfig?.compactionDebug);
  } catch {
    return false;
  }
};

export const isCompactionDebugClientEnabled = (): boolean => {
  const override = readStorageOverride();
  if (override !== undefined) return override;
  return readServerConfigFlag();
};

export const createCompactionDebugSpanId = (): string => {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `cd_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    const time = Date.now().toString(16).padStart(8, '0').slice(-8);
    const random = Math.floor(Math.random() * 0xFF_FF_FF_FF)
      .toString(16)
      .padStart(8, '0');
    return `cd_${time}${random}`;
  }
};

/**
 * sha256-16 fingerprint of an identifier, matching the server-side
 * `hashCompactionDebugValue` so client and server hashes compare.
 */
export const hashCompactionDebugClientValue = async (value: string): Promise<string> => {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  } catch {
    let hash = 0x81_1C_9D_C5;
    for (const character of value) {
      hash ^= character.codePointAt(0) || 0;
      hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
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

export const flushCompactionDebugClient = () => {
  if (typeof window === 'undefined' || queue.length === 0) return;
  const events = queue;
  queue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }

  import('@/libs/trpc/client')
    .then(({ lambdaClient }) =>
      lambdaClient.conversationGeneration.reportCompactionDebug.mutate(
        { events },
        { context: { showNotification: false } },
      ),
    )
    .catch(() => {
      // Diagnostics must never interrupt compaction.
    });
};

export const logCompactionDebugClientSafe = (
  event: CompactionDebugClientEvent,
  fields: Record<string, unknown> = {},
) => {
  try {
    if (typeof window === 'undefined') return;
    if (!isCompactionDebugClientEnabled()) return;

    queue.push({ event, fields: boundClientDebugFields(fields) });
    if (queue.length >= CLIENT_DEBUG_MAX_EVENTS_PER_FLUSH) {
      flushCompactionDebugClient();
      return;
    }

    flushTimer ??= setTimeout(() => {
      flushTimer = undefined;
      flushCompactionDebugClient();
    }, CLIENT_DEBUG_FLUSH_INTERVAL_MS);

    if (!pageHideListenerRegistered) {
      pageHideListenerRegistered = true;
      window.addEventListener('pagehide', () => flushCompactionDebugClient(), { once: true });
    }
  } catch {
    // Diagnostics must never interrupt compaction.
  }
};

const hashOptionalDebugValue = async (value?: string | null): Promise<string | undefined> => {
  if (!value) return undefined;
  return hashCompactionDebugClientValue(value);
};

/** Hashes session/topic then emits `watcher_armed` when a token-threshold attempt is scheduled. */
export const logCompactionWatcherArmed = async (input: {
  highWatermark: number;
  knowledgeBaseToken: number;
  maxTokens: number;
  ratio: number;
  sessionId?: string | null;
  topicId?: string | null;
  totalToken: number;
}) => {
  try {
    if (!isCompactionDebugClientEnabled()) return;
    const { sessionId, topicId, ...fields } = input;
    const [sessionHash, topicHash] = await Promise.all([
      hashOptionalDebugValue(sessionId),
      hashOptionalDebugValue(topicId),
    ]);
    logCompactionDebugClientSafe('watcher_armed', {
      ...fields,
      sessionHash,
      topicHash,
    });
  } catch {
    // Diagnostics must never interrupt compaction.
  }
};
