import type { ChatStore } from '@/store/chat/store';

import { messageMapKey } from './messageMapKey';

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

export const resolveConversationClearGeneration = (
  state: Pick<ChatStore, 'conversationClearGeneration' | 'conversationScopedClearGenerations'>,
  sessionId?: string | null,
  topicId?: string | null,
  threadId?: string | null,
) => {
  if (!sessionId) return state.conversationClearGeneration;

  const topicKey = topicScopedClearKey(sessionId, topicId);
  const laneKey = laneScopedClearKey(sessionId, topicId, threadId);
  const topicScoped = state.conversationScopedClearGenerations[topicKey] ?? 0;
  const laneScoped = state.conversationScopedClearGenerations[laneKey] ?? 0;

  return Math.max(state.conversationClearGeneration, topicScoped, laneScoped);
};

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
): StoppedOperationRef[] => {
  const topicKey = messageMapKey(sessionId, topicId);
  const targetThreadId = threadId ?? null;

  return Object.values(state.serverGenerationOperations[topicKey] || {})
    .filter((operation) => (operation.threadId ?? null) === targetThreadId)
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

const collectInFlightIdempotencyKeys = (
  state: Pick<ChatStore, 'durableInFlightIdempotencyKeys'>,
  laneKeyPrefix: string,
): StoppedOperationRef[] =>
  Object.entries(state.durableInFlightIdempotencyKeys)
    .filter(([laneKey]) => laneKey === laneKeyPrefix || laneKey.startsWith(`${laneKeyPrefix}:`))
    .flatMap(([, keys]) => keys)
    .map((idempotencyKey) => ({ idempotencyKey }));

export const trackDurableEnqueueIdempotencyKey = (
  state: Pick<ChatStore, 'durableInFlightIdempotencyKeys'>,
  laneKey: string,
  idempotencyKey: string,
): Pick<ChatStore, 'durableInFlightIdempotencyKeys'> => {
  const existing = state.durableInFlightIdempotencyKeys[laneKey] ?? [];
  if (existing.includes(idempotencyKey)) {
    return { durableInFlightIdempotencyKeys: state.durableInFlightIdempotencyKeys };
  }

  return {
    durableInFlightIdempotencyKeys: {
      ...state.durableInFlightIdempotencyKeys,
      [laneKey]: [...existing, idempotencyKey],
    },
  };
};

export const untrackDurableEnqueueIdempotencyKey = (
  state: Pick<ChatStore, 'durableInFlightIdempotencyKeys'>,
  laneKey: string,
  idempotencyKey: string,
): Pick<ChatStore, 'durableInFlightIdempotencyKeys'> => {
  const existing = state.durableInFlightIdempotencyKeys[laneKey];
  if (!existing) {
    return { durableInFlightIdempotencyKeys: state.durableInFlightIdempotencyKeys };
  }

  const nextKeys = existing.filter((key) => key !== idempotencyKey);
  const durableInFlightIdempotencyKeys = { ...state.durableInFlightIdempotencyKeys };
  if (nextKeys.length > 0) {
    durableInFlightIdempotencyKeys[laneKey] = nextKeys;
  } else {
    delete durableInFlightIdempotencyKeys[laneKey];
  }

  return { durableInFlightIdempotencyKeys };
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

export const markConversationLaneDurableGenerationStopped = (
  state: LaneStopMarkerState &
    Pick<ChatStore, 'durableInFlightIdempotencyKeys' | 'serverGenerationOperations'>,
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
) => {
  const laneKey = laneScopedClearKey(sessionId, topicId, threadId);

  return recordStoppedDurableOperationsInMarkers(
    state,
    sessionId,
    [
      ...collectAttachedOperationsForLane(state, sessionId, topicId, threadId),
      ...collectInFlightIdempotencyKeys(state, laneKey),
    ],
    topicId,
    threadId,
  );
};

/**
 * Topic-wide tombstone (e.g. topic delete): written to the topic marker key so
 * sync fences every lane of the removed topic. Cutoffs stay keyed by server lane.
 */
export const markConversationTopicDurableGenerationStopped = (
  state: LaneStopMarkerState &
    Pick<ChatStore, 'durableInFlightIdempotencyKeys' | 'serverGenerationOperations'>,
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
