import type { ChatStore } from '@/store/chat/store';

import { messageMapKey } from './messageMapKey';

export interface ConversationLaneStopMarker {
  /** Sync rejects same-lane ops at or below this server lane generation. */
  maxStoppedLaneGeneration?: number;
  /** Server operation ids explicitly cancelled for this lane/topic fence. */
  stoppedOperationIds: string[];
}

type StoppedOperationRef = {
  laneGeneration?: number;
  operationId: string;
};

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
  const stoppedOperationIds = [
    ...new Set([
      ...(existing?.stoppedOperationIds ?? []),
      ...operations.map((operation) => operation.operationId),
    ]),
  ];
  const laneGenerations = operations
    .map((operation) => operation.laneGeneration)
    .filter((laneGeneration): laneGeneration is number => laneGeneration !== undefined);
  const maxFromOps = laneGenerations.length > 0 ? Math.max(...laneGenerations) : 0;
  const maxStoppedLaneGeneration = Math.max(existing?.maxStoppedLaneGeneration ?? 0, maxFromOps);

  return {
    maxStoppedLaneGeneration: maxStoppedLaneGeneration > 0 ? maxStoppedLaneGeneration : undefined,
    stoppedOperationIds,
  };
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
  operationId?: string,
  laneGeneration?: number,
) => {
  if (!marker) return false;

  if (operationId && marker.stoppedOperationIds.includes(operationId)) return true;

  if (
    laneGeneration !== undefined &&
    marker.maxStoppedLaneGeneration !== undefined &&
    laneGeneration <= marker.maxStoppedLaneGeneration
  ) {
    return true;
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
    laneGeneration: operation.laneGeneration,
    operationId: operation.operationId,
  }));
};

export const recordStoppedDurableOperationsInMarkers = (
  state: LaneStopMarkerState,
  sessionId: string,
  operations: StoppedOperationRef[],
  topicId?: string | null,
  threadId?: string | null,
) => {
  if (operations.length === 0) return {};

  let conversationLaneStopMarkers = state.conversationLaneStopMarkers;
  const laneKey = laneScopedClearKey(sessionId, topicId, threadId);
  conversationLaneStopMarkers = applyStoppedOperationsToMarkerKey(
    conversationLaneStopMarkers,
    laneKey,
    operations,
  );

  if (topicId) {
    const topicKey = topicScopedClearKey(sessionId, topicId);
    conversationLaneStopMarkers = applyStoppedOperationsToMarkerKey(
      conversationLaneStopMarkers,
      topicKey,
      operations,
    );
  }

  return { conversationLaneStopMarkers };
};

export const markConversationLaneDurableGenerationStopped = (
  state: LaneStopMarkerState & Pick<ChatStore, 'serverGenerationOperations'>,
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
) =>
  recordStoppedDurableOperationsInMarkers(
    state,
    sessionId,
    collectAttachedOperationsForLane(state, sessionId, topicId, threadId),
    topicId,
    threadId,
  );

export const markConversationTopicDurableGenerationStopped = (
  state: LaneStopMarkerState & Pick<ChatStore, 'serverGenerationOperations'>,
  sessionId: string,
  topicId?: string | null,
) =>
  recordStoppedDurableOperationsInMarkers(
    state,
    sessionId,
    collectAttachedOperationsForTopic(state, sessionId, topicId),
    topicId,
    null,
  );

export const isConversationLaneDurableGenerationStopped = (
  state: LaneStopMarkerState,
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
  operationId?: string,
  laneGeneration?: number,
) =>
  isMarkerSuppressedForOperation(
    state.conversationLaneStopMarkers?.[laneScopedClearKey(sessionId, topicId, threadId)],
    operationId,
    laneGeneration,
  );

export const isConversationTopicDurableGenerationStopped = (
  state: LaneStopMarkerState,
  sessionId: string,
  topicId?: string | null,
  operationId?: string,
  laneGeneration?: number,
) =>
  isMarkerSuppressedForOperation(
    state.conversationLaneStopMarkers?.[topicScopedClearKey(sessionId, topicId)],
    operationId,
    laneGeneration,
  );
