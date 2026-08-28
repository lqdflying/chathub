import {
  flushGenerationDebugClient,
  hashGenerationDebugClientValue,
  logGenerationDebugClientSafe,
} from '@/libs/logger/generationDebugClient';

/**
 * CHATHUB_GENERATION_DEBUG drop logging. SSE replays the account-wide event
 * log; most of those events belong to operations this tab never attached.
 * Per-event `event_dropped` is reserved for drops that can explain a missing
 * reply. Everything else is counted into `event_drop_summary`.
 */

export const EVENT_DROP_ATTACH_RACE_MS = 300;
export const EVENT_DROP_SUMMARY_FLUSH_AT = 50;
const DROPPED_LOG_MAX_KEYS = 256;

type DropReason = 'not_attached' | 'stale_revision';

const everAttachedOperationIds = new Set<string>();
/** Insertion-order LRU of already-emitted non-terminal / stale throttle keys. */
const droppedLogKeys = new Map<string, true>();

let notAttachedCount = 0;
let notAttachedDone = 0;
let notAttachedError = 0;
let notAttachedStatus = 0;
let notAttachedSnapshot = 0;
let staleRevisionCount = 0;
let emittedCount = 0;
let suppressedCount = 0;
const distinctOps = new Set<string>();

interface PendingTerminalDrop {
  operationId: string;
  reason: DropReason;
  revision?: number;
  timer: ReturnType<typeof setTimeout>;
  type: string;
}

const pendingTerminalDrops = new Map<string, PendingTerminalDrop>();
let pageHideListenerRegistered = false;

const isTerminalType = (type: string) => type === 'done' || type === 'error';

const resetSummaryCounters = () => {
  notAttachedCount = 0;
  notAttachedDone = 0;
  notAttachedError = 0;
  notAttachedStatus = 0;
  notAttachedSnapshot = 0;
  staleRevisionCount = 0;
  emittedCount = 0;
  suppressedCount = 0;
  distinctOps.clear();
};

const recordDropShape = (
  operationId: string,
  reason: DropReason,
  type: string,
  emitted: boolean,
) => {
  distinctOps.add(operationId);
  if (emitted) emittedCount += 1;
  else suppressedCount += 1;
  if (reason === 'stale_revision') {
    staleRevisionCount += 1;
    return;
  }
  notAttachedCount += 1;
  if (type === 'done') notAttachedDone += 1;
  else if (type === 'error') notAttachedError += 1;
  else if (type === 'status') notAttachedStatus += 1;
  else if (type === 'snapshot') notAttachedSnapshot += 1;
};

export const flushEventDropSummary = () => {
  try {
    if (suppressedCount === 0) return;
    logGenerationDebugClientSafe('event_drop_summary', {
      distinctOps: distinctOps.size,
      emittedCount,
      notAttachedCount,
      notAttachedDone,
      notAttachedError,
      notAttachedSnapshot,
      notAttachedStatus,
      staleRevisionCount,
      suppressedCount,
    });
    resetSummaryCounters();
  } catch {
    // Diagnostics must never interrupt conversation generation.
  }
};

/**
 * Remaining attach-race timers have not seen attach; treat them as suppressed
 * so a hide/unload summary includes them.
 */
const settlePendingTerminalDropsOnHide = () => {
  for (const [key, pending] of Array.from(pendingTerminalDrops.entries())) {
    clearTimeout(pending.timer);
    pendingTerminalDrops.delete(key);
    recordDropShape(pending.operationId, pending.reason, pending.type, false);
  }
};

const onPageHide = () => {
  settlePendingTerminalDropsOnHide();
  flushEventDropSummary();
  flushGenerationDebugClient();
};

const ensurePageHideFlush = () => {
  if (pageHideListenerRegistered || typeof window === 'undefined') return;
  pageHideListenerRegistered = true;
  window.addEventListener('pagehide', onPageHide);
};

const touchThrottleKey = (key: string) => {
  if (droppedLogKeys.has(key)) {
    droppedLogKeys.delete(key);
    droppedLogKeys.set(key, true);
    return;
  }
  while (droppedLogKeys.size >= DROPPED_LOG_MAX_KEYS) {
    const oldest = droppedLogKeys.keys().next().value;
    if (oldest === undefined) break;
    droppedLogKeys.delete(oldest);
  }
  droppedLogKeys.set(key, true);
};

const emitEventDropped = (
  operationId: string,
  reason: DropReason,
  type: string,
  revision: number | undefined,
  hadAttached: boolean,
) => {
  recordDropShape(operationId, reason, type, true);
  void hashGenerationDebugClientValue(operationId)
    .then((operationHash) => {
      logGenerationDebugClientSafe('event_dropped', {
        hadAttached,
        operationHash,
        reason,
        revision,
        type,
      });
    })
    .catch(() => {
      // Diagnostics must never interrupt conversation generation.
    });
};

const suppressDrop = (operationId: string, reason: DropReason, type: string) => {
  recordDropShape(operationId, reason, type, false);
  if (suppressedCount >= EVENT_DROP_SUMMARY_FLUSH_AT) flushEventDropSummary();
};

const pendingKey = (operationId: string, type: string) => `${operationId}:${type}`;

const emitPendingForOperation = (operationId: string) => {
  for (const [key, pending] of Array.from(pendingTerminalDrops.entries())) {
    if (pending.operationId !== operationId) continue;
    clearTimeout(pending.timer);
    pendingTerminalDrops.delete(key);
    emitEventDropped(pending.operationId, pending.reason, pending.type, pending.revision, true);
  }
};

const scheduleTerminalAttachRace = (
  operationId: string,
  reason: DropReason,
  type: string,
  revision?: number,
) => {
  const key = pendingKey(operationId, type);
  if (pendingTerminalDrops.has(key)) {
    suppressDrop(operationId, reason, type);
    return;
  }
  const timer = setTimeout(() => {
    pendingTerminalDrops.delete(key);
    if (everAttachedOperationIds.has(operationId)) {
      emitEventDropped(operationId, reason, type, revision, true);
      return;
    }
    suppressDrop(operationId, reason, type);
  }, EVENT_DROP_ATTACH_RACE_MS);
  pendingTerminalDrops.set(key, { operationId, reason, revision, timer, type });
};

/**
 * Remember that this tab attached `operationId`. Detach does not forget.
 * Flushes a pending attach-race terminal drop as `hadAttached: true`.
 */
export const noteConversationGenerationAttached = (operationId: string) => {
  try {
    everAttachedOperationIds.add(operationId);
    emitPendingForOperation(operationId);
  } catch {
    // Diagnostics must never interrupt attach.
  }
};

/** Test-only / account-switch: drop remembered attach + throttle + pending timers. */
export const resetEventDroppedDebugState = () => {
  everAttachedOperationIds.clear();
  droppedLogKeys.clear();
  for (const pending of pendingTerminalDrops.values()) clearTimeout(pending.timer);
  pendingTerminalDrops.clear();
  resetSummaryCounters();
};

export const logEventDropped = (
  operationId: string,
  reason: DropReason,
  type: string,
  revision?: number,
) => {
  try {
    ensurePageHideFlush();
    const hadAttached = everAttachedOperationIds.has(operationId);
    const terminal = isTerminalType(type);

    if (reason === 'stale_revision') {
      const key = `${operationId}:${type}`;
      if (droppedLogKeys.has(key)) {
        suppressDrop(operationId, reason, type);
        return;
      }
      touchThrottleKey(key);
      emitEventDropped(operationId, reason, type, revision, hadAttached);
      return;
    }

    if (!hadAttached) {
      if (terminal) {
        scheduleTerminalAttachRace(operationId, reason, type, revision);
        return;
      }
      suppressDrop(operationId, reason, type);
      return;
    }

    if (!terminal) {
      const key = `${operationId}:${reason}`;
      if (droppedLogKeys.has(key)) {
        suppressDrop(operationId, reason, type);
        return;
      }
      touchThrottleKey(key);
      emitEventDropped(operationId, reason, type, revision, true);
      return;
    }

    emitEventDropped(operationId, reason, type, revision, true);
  } catch {
    // Diagnostics must never interrupt conversation generation.
  }
};
