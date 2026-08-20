import {
  type ConversationGenerationKind,
  isConversationGenerationChatFamilyKind,
} from '@lobechat/types';

import type { ChatStore } from '@/store/chat/store';

import { messageMapKey } from './messageMapKey';

type AttachedOperationRef = Pick<
  ChatStore['serverGenerationOperations'][string][string],
  'lane' | 'laneGeneration' | 'operationId' | 'sessionId' | 'threadId' | 'topicId'
>;

export interface ConversationLaneStopMarker {
  /**
   * Per-server-lane generation cutoffs: server `operation.lane` -> max stopped
   * `laneGeneration`. Keyed by the exact server lane because lane generations are
   * independent per lane (main vs portal thread vs group agent); a cutoff for one
   * server lane must never reject an operation on another.
   */
  laneGenerations: Record<string, number>;
  /** Idempotency keys fenced while their enqueue request was in flight at Stop time. */
  stoppedIdempotencyKeys: string[];
  /** Server operation ids explicitly cancelled for this lane/topic fence. */
  stoppedOperationIds: string[];
}

export interface ConversationGenerationFenceRef {
  idempotencyKey?: string | null;
  lane?: string;
  laneGeneration?: number;
  operationId?: string;
}

type StoppedOperationRef = ConversationGenerationFenceRef;

const topicScopedClearKey = (sessionId: string, topicId?: string | null) =>
  messageMapKey(sessionId, topicId);

export const laneScopedClearKey = (
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
) => `${messageMapKey(sessionId, topicId)}:${threadId ?? 'main'}`;

/**
 * The lane-scoped epoch is the chat-Stop fence: bumping it invalidates in-flight
 * chat work without tearing down unrelated title/translation/compaction jobs that
 * share the conversation. Non-chat families therefore resolve against the
 * destructive epochs (global clear + topic tombstone) only.
 */
export const resolveConversationClearGeneration = (
  state: Pick<ChatStore, 'conversationClearGeneration' | 'conversationScopedClearGenerations'>,
  sessionId?: string | null,
  topicId?: string | null,
  threadId?: string | null,
  kind?: ConversationGenerationKind,
) => {
  if (!sessionId) return state.conversationClearGeneration;

  const topicKey = topicScopedClearKey(sessionId, topicId);
  const topicScoped = state.conversationScopedClearGenerations[topicKey] ?? 0;
  const laneScoped =
    kind && !isConversationGenerationChatFamilyKind(kind)
      ? 0
      : (state.conversationScopedClearGenerations[
          laneScopedClearKey(sessionId, topicId, threadId)
        ] ?? 0);

  return Math.max(state.conversationClearGeneration, topicScoped, laneScoped);
};

/**
 * Compares a producer's captured clear fence against the current resolve.
 * Capturing and re-checking the full resolved fence (global clear epoch +
 * topic tombstone + chat-family lane epoch) detects destructive actions that
 * never touch the global epoch — notably topic deletion — before the producer
 * registers its in-flight key or attaches a returned operation.
 */
export const isConversationClearFenceCurrent = (
  state: Pick<ChatStore, 'conversationClearGeneration' | 'conversationScopedClearGenerations'>,
  capturedFence: number,
  sessionId?: string | null,
  topicId?: string | null,
  threadId?: string | null,
  kind?: ConversationGenerationKind,
) =>
  resolveConversationClearGeneration(state, sessionId, topicId, threadId, kind) === capturedFence;

export const bumpTopicScopedClearGeneration = (
  state: Pick<ChatStore, 'conversationClearGeneration' | 'conversationScopedClearGenerations'>,
  sessionId: string,
  topicId?: string | null,
) => {
  const topicKey = topicScopedClearKey(sessionId, topicId);
  let scopedMax = state.conversationScopedClearGenerations[topicKey] ?? 0;

  for (const [key, value] of Object.entries(state.conversationScopedClearGenerations)) {
    if (key === topicKey || key.startsWith(`${topicKey}:`)) {
      scopedMax = Math.max(scopedMax, value);
    }
  }

  const nextScoped = Math.max(state.conversationClearGeneration, scopedMax) + 1;

  return {
    conversationScopedClearGenerations: {
      ...state.conversationScopedClearGenerations,
      [topicKey]: nextScoped,
    },
  };
};

export const bumpLaneScopedClearGeneration = (
  state: Pick<ChatStore, 'conversationClearGeneration' | 'conversationScopedClearGenerations'>,
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
) => {
  const laneKey = laneScopedClearKey(sessionId, topicId, threadId);
  const nextScoped = resolveConversationClearGeneration(state, sessionId, topicId, threadId) + 1;

  return {
    conversationScopedClearGenerations: {
      ...state.conversationScopedClearGenerations,
      [laneKey]: nextScoped,
    },
  };
};

/** Topic-wide tombstone (e.g. topic delete). Prefer {@link bumpLaneScopedClearGeneration} for Stop. */
export const bumpScopedConversationClearGeneration = bumpTopicScopedClearGeneration;

type LaneStopMarkerState = Pick<ChatStore, 'conversationLaneStopMarkers'>;

const mergeStoppedOperations = (
  existing: ConversationLaneStopMarker | undefined,
  operations: StoppedOperationRef[],
): ConversationLaneStopMarker => {
  const laneGenerations: Record<string, number> = { ...existing?.laneGenerations };
  for (const operation of operations) {
    if (operation.lane && operation.laneGeneration !== undefined) {
      laneGenerations[operation.lane] = Math.max(
        laneGenerations[operation.lane] ?? 0,
        operation.laneGeneration,
      );
    }
  }

  const stoppedIdempotencyKeys = [
    ...new Set([
      ...(existing?.stoppedIdempotencyKeys ?? []),
      ...operations
        .map((operation) => operation.idempotencyKey)
        .filter((key): key is string => !!key),
    ]),
  ];
  const stoppedOperationIds = [
    ...new Set([
      ...(existing?.stoppedOperationIds ?? []),
      ...operations.map((operation) => operation.operationId).filter((id): id is string => !!id),
    ]),
  ];

  return { laneGenerations, stoppedIdempotencyKeys, stoppedOperationIds };
};

const applyStoppedOperationsToMarkerKey = (
  markers: LaneStopMarkerState['conversationLaneStopMarkers'],
  markerKey: string,
  operations: StoppedOperationRef[],
) => ({
  ...markers,
  [markerKey]: mergeStoppedOperations(markers[markerKey], operations),
});

const isMarkerSuppressedForOperation = (
  marker: ConversationLaneStopMarker | undefined,
  ref: ConversationGenerationFenceRef,
) => {
  if (!marker) return false;

  if (ref.operationId && marker.stoppedOperationIds.includes(ref.operationId)) return true;

  if (ref.idempotencyKey && marker.stoppedIdempotencyKeys.includes(ref.idempotencyKey)) {
    return true;
  }

  if (ref.lane && ref.laneGeneration !== undefined) {
    const cutoff = marker.laneGenerations[ref.lane];
    if (cutoff !== undefined && ref.laneGeneration <= cutoff) return true;
  }

  return false;
};

const collectAttachedOperationsForLane = (
  state: Pick<ChatStore, 'serverGenerationOperations'>,
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
  kindFilter?: (kind: ConversationGenerationKind) => boolean,
): StoppedOperationRef[] => {
  const topicKey = messageMapKey(sessionId, topicId);
  const targetThreadId = threadId ?? null;

  return Object.values(state.serverGenerationOperations[topicKey] || {})
    .filter(
      (operation) =>
        (operation.threadId ?? null) === targetThreadId &&
        (!kindFilter || kindFilter(operation.kind)),
    )
    .map((operation) => ({
      lane: operation.lane,
      laneGeneration: operation.laneGeneration,
      operationId: operation.operationId,
    }));
};

const collectAttachedOperationsForTopic = (
  state: Pick<ChatStore, 'serverGenerationOperations'>,
  sessionId: string,
  topicId?: string | null,
): StoppedOperationRef[] => {
  const topicKey = messageMapKey(sessionId, topicId);

  return Object.values(state.serverGenerationOperations[topicKey] || {}).map((operation) => ({
    lane: operation.lane,
    laneGeneration: operation.laneGeneration,
    operationId: operation.operationId,
  }));
};

/**
 * A durable enqueue request currently in flight, keyed by the client lane it was
 * sent from. `kind` lets a chat Stop fence only chat-family enqueues while a
 * destructive clear/delete collects every kind.
 */
export interface DurableInFlightEnqueue {
  idempotencyKey: string;
  kind: ConversationGenerationKind;
}

const collectInFlightIdempotencyKeys = (
  state: Pick<ChatStore, 'durableInFlightEnqueues'>,
  laneKeyPrefix: string,
  kindFilter?: (kind: ConversationGenerationKind) => boolean,
): StoppedOperationRef[] =>
  Object.entries(state.durableInFlightEnqueues)
    .filter(([laneKey]) => laneKey === laneKeyPrefix || laneKey.startsWith(`${laneKeyPrefix}:`))
    .flatMap(([, entries]) => entries)
    .filter((entry) => !kindFilter || kindFilter(entry.kind))
    .map((entry) => ({ idempotencyKey: entry.idempotencyKey }));

export const trackDurableEnqueue = (
  state: Pick<ChatStore, 'durableInFlightEnqueues'>,
  laneKey: string,
  entry: DurableInFlightEnqueue,
): Pick<ChatStore, 'durableInFlightEnqueues'> => {
  const existing = state.durableInFlightEnqueues[laneKey] ?? [];
  if (existing.some((item) => item.idempotencyKey === entry.idempotencyKey)) {
    return { durableInFlightEnqueues: state.durableInFlightEnqueues };
  }

  return {
    durableInFlightEnqueues: {
      ...state.durableInFlightEnqueues,
      [laneKey]: [...existing, entry],
    },
  };
};

export const untrackDurableEnqueue = (
  state: Pick<ChatStore, 'durableInFlightEnqueues'>,
  laneKey: string,
  idempotencyKey: string,
): Pick<ChatStore, 'durableInFlightEnqueues'> => {
  const existing = state.durableInFlightEnqueues[laneKey];
  if (!existing) {
    return { durableInFlightEnqueues: state.durableInFlightEnqueues };
  }

  const nextEntries = existing.filter((entry) => entry.idempotencyKey !== idempotencyKey);
  const durableInFlightEnqueues = { ...state.durableInFlightEnqueues };
  if (nextEntries.length > 0) {
    durableInFlightEnqueues[laneKey] = nextEntries;
  } else {
    delete durableInFlightEnqueues[laneKey];
  }

  return { durableInFlightEnqueues };
};

/**
 * Records a lane-scoped stop fence. Only the exact lane key is written — a lane
 * Stop must never project its cutoff onto the topic-wide key, because server lane
 * generations are independent and the topic marker is read for every lane.
 */
export const recordStoppedDurableOperationsInMarkers = (
  state: LaneStopMarkerState,
  sessionId: string,
  operations: StoppedOperationRef[],
  topicId?: string | null,
  threadId?: string | null,
): LaneStopMarkerState => {
  if (operations.length === 0) {
    return { conversationLaneStopMarkers: state.conversationLaneStopMarkers };
  }

  const laneKey = laneScopedClearKey(sessionId, topicId, threadId);

  return {
    conversationLaneStopMarkers: applyStoppedOperationsToMarkerKey(
      state.conversationLaneStopMarkers,
      laneKey,
      operations,
    ),
  };
};

/**
 * Tombstones already-attached operations in a cancellation scope, each under
 * its own lane key. A best-effort cancel that fails or is lost must not let a
 * rediscovering sync reattach the operation — the marker fences it by id and
 * lane cutoff. Callers filter the operations to their scope first.
 */
export const recordAttachedOperationsStopped = (
  state: LaneStopMarkerState,
  operations: Array<Pick<AttachedOperationRef, 'operationId'> & Partial<AttachedOperationRef>>,
): LaneStopMarkerState => {
  let conversationLaneStopMarkers = state.conversationLaneStopMarkers;

  for (const operation of operations) {
    if (!operation.sessionId) continue;
    conversationLaneStopMarkers = applyStoppedOperationsToMarkerKey(
      conversationLaneStopMarkers,
      laneScopedClearKey(operation.sessionId, operation.topicId, operation.threadId ?? null),
      [
        {
          lane: operation.lane,
          laneGeneration: operation.laneGeneration,
          operationId: operation.operationId,
        },
      ],
    );
  }

  return { conversationLaneStopMarkers };
};

/**
 * Records a lane-scoped stop fence for the **chat family**. Only the exact lane
 * key is written — a lane Stop must never project its cutoff onto the topic-wide
 * key, because server lane generations are independent and the topic marker is
 * read for every lane. Title, translation, and compaction operations share the
 * client lane but are not chat work, so they are excluded from the fence.
 */
export const markConversationLaneDurableGenerationStopped = (
  state: LaneStopMarkerState &
    Pick<ChatStore, 'durableInFlightEnqueues' | 'serverGenerationOperations'>,
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
) => {
  const laneKey = laneScopedClearKey(sessionId, topicId, threadId);

  return recordStoppedDurableOperationsInMarkers(
    state,
    sessionId,
    [
      ...collectAttachedOperationsForLane(
        state,
        sessionId,
        topicId,
        threadId,
        isConversationGenerationChatFamilyKind,
      ),
      ...collectInFlightIdempotencyKeys(state, laneKey, isConversationGenerationChatFamilyKind),
    ],
    topicId,
    threadId,
  );
};

/**
 * Topic-wide tombstone (e.g. topic delete, clear): written to the topic marker
 * key so sync fences every lane of the removed topic, across all operation
 * kinds. Cutoffs stay keyed by server lane.
 */
export const markConversationTopicDurableGenerationStopped = (
  state: LaneStopMarkerState &
    Pick<ChatStore, 'durableInFlightEnqueues' | 'serverGenerationOperations'>,
  sessionId: string,
  topicId?: string | null,
): LaneStopMarkerState => {
  const topicKey = topicScopedClearKey(sessionId, topicId);
  const operations = [
    ...collectAttachedOperationsForTopic(state, sessionId, topicId),
    ...collectInFlightIdempotencyKeys(state, topicKey),
  ];

  if (operations.length === 0) {
    return { conversationLaneStopMarkers: state.conversationLaneStopMarkers };
  }

  return {
    conversationLaneStopMarkers: applyStoppedOperationsToMarkerKey(
      state.conversationLaneStopMarkers,
      topicKey,
      operations,
    ),
  };
};

/**
 * Global destructive tombstone (clear-all): records every attached operation and
 * in-flight enqueue into its own lane marker so sync fences late-appearing jobs
 * for every conversation.
 */
export const markAllDurableGenerationsStopped = (
  state: LaneStopMarkerState &
    Pick<ChatStore, 'durableInFlightEnqueues' | 'serverGenerationOperations'>,
): LaneStopMarkerState => {
  let conversationLaneStopMarkers = state.conversationLaneStopMarkers;

  for (const operations of Object.values(state.serverGenerationOperations)) {
    for (const operation of Object.values(operations)) {
      if (!operation.sessionId) continue;
      conversationLaneStopMarkers = applyStoppedOperationsToMarkerKey(
        conversationLaneStopMarkers,
        laneScopedClearKey(operation.sessionId, operation.topicId, operation.threadId ?? null),
        [
          {
            lane: operation.lane,
            laneGeneration: operation.laneGeneration,
            operationId: operation.operationId,
          },
        ],
      );
    }
  }

  for (const [laneKey, entries] of Object.entries(state.durableInFlightEnqueues)) {
    if (entries.length === 0) continue;
    conversationLaneStopMarkers = applyStoppedOperationsToMarkerKey(
      conversationLaneStopMarkers,
      laneKey,
      entries.map((entry) => ({ idempotencyKey: entry.idempotencyKey })),
    );
  }

  return { conversationLaneStopMarkers };
};

/**
 * Fences in-flight enqueues matching a cancellation scope before the scope's
 * server-side snapshot runs. Entries carry no group id, so group scopes match
 * through the session/topic lane like the attached-operation path does.
 */
export const recordInFlightEnqueuesForScope = (
  state: LaneStopMarkerState & Pick<ChatStore, 'durableInFlightEnqueues'>,
  scope: {
    allConversations?: boolean;
    allThreads?: boolean;
    kinds?: ConversationGenerationKind[];
    sessionId?: string;
    threadId?: string | null;
    topicId?: string | null;
    topicIds?: string[];
  },
): LaneStopMarkerState => {
  let conversationLaneStopMarkers = state.conversationLaneStopMarkers;

  for (const [laneKey, entries] of Object.entries(state.durableInFlightEnqueues)) {
    const matched = entries.filter((entry) => !scope.kinds || scope.kinds.includes(entry.kind));
    if (matched.length === 0) continue;

    if (!scope.allConversations) {
      if (!scope.sessionId) continue;
      if (scope.topicIds) {
        const matchesTopic = scope.topicIds.some((topicId) => {
          const topicPrefix = topicScopedClearKey(scope.sessionId!, topicId);
          return laneKey === topicPrefix || laneKey.startsWith(`${topicPrefix}:`);
        });
        if (!matchesTopic) continue;
      } else if (scope.allThreads) {
        const topicPrefix = topicScopedClearKey(scope.sessionId, scope.topicId);
        if (laneKey !== topicPrefix && !laneKey.startsWith(`${topicPrefix}:`)) continue;
      } else if (laneKey !== laneScopedClearKey(scope.sessionId, scope.topicId, scope.threadId)) {
        continue;
      }
    }

    conversationLaneStopMarkers = applyStoppedOperationsToMarkerKey(
      conversationLaneStopMarkers,
      laneKey,
      matched.map((entry) => ({ idempotencyKey: entry.idempotencyKey })),
    );
  }

  return { conversationLaneStopMarkers };
};

/**
 * Idempotency keys are unique per enqueue attempt, so a fenced key rejects the
 * operation no matter which topic the server persisted it under — this is the
 * fence that survives auto-created-topic relocation.
 */
export const isDurableIdempotencyKeyStopped = (
  state: LaneStopMarkerState,
  idempotencyKey?: string | null,
) =>
  !!idempotencyKey &&
  Object.values(state.conversationLaneStopMarkers).some((marker) =>
    marker.stoppedIdempotencyKeys.includes(idempotencyKey),
  );

export const isConversationLaneDurableGenerationStopped = (
  state: LaneStopMarkerState,
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
  ref: ConversationGenerationFenceRef = {},
) =>
  isMarkerSuppressedForOperation(
    state.conversationLaneStopMarkers?.[laneScopedClearKey(sessionId, topicId, threadId)],
    ref,
  );

export const isConversationTopicDurableGenerationStopped = (
  state: LaneStopMarkerState,
  sessionId: string,
  topicId?: string | null,
  ref: ConversationGenerationFenceRef = {},
) =>
  isMarkerSuppressedForOperation(
    state.conversationLaneStopMarkers?.[topicScopedClearKey(sessionId, topicId)],
    ref,
  );
