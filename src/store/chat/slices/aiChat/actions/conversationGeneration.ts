import { LOADING_FLAT, MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import {
  ConversationGenerationChatFamilyKinds,
  type ConversationGenerationDeferReason,
  type ConversationGenerationEvent,
  type ConversationGenerationKind,
  type ConversationGenerationOperation,
} from '@lobechat/types';
import { StateCreator } from 'zustand/vanilla';

import {
  hashGenerationDebugClientValue,
  logGenerationDebugClientSafe,
} from '@/libs/logger/generationDebugClient';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import type { ChatStore } from '@/store/chat/store';
import type { ConversationContext } from '@/store/chat/types';
import { toggleBooleanList } from '@/store/chat/utils';
import {
  isConversationLaneDurableGenerationStopped,
  isConversationTopicDurableGenerationStopped,
  isDurableIdempotencyKeyStopped,
  recordAttachedOperationsStopped,
  recordInFlightEnqueuesForScope,
  recordStoppedDurableOperationsInMarkers,
  resolveConversationClearGeneration,
} from '@/store/chat/utils/conversationClearGeneration';
import {
  deferredBrowserGenerationLaneKey,
  deferredBrowserGenerationLaneKeysForTopic,
} from '@/store/chat/utils/deferredBrowserGeneration';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { setNamespace } from '@/utils/storeDebug';

import type { ServerGenerationOperation } from '../../topic/initialState';

const n = setNamespace('durableGeneration');

// Orphaned `...` placeholders (interrupted browser turns) are only removed once
// older than this, so a live producer in another tab can still finalize them.
const ORPHAN_PLACEHOLDER_GRACE_MS = 5 * 60 * 1000;

// Snapshot events for an active-but-detached operation arrive every ~1.5s via
// SSE/poll; log only the first drop per operation+reason so a long detached
// window produces one event, not a flood. Terminal drops are always logged.
const droppedSnapshotLogKeys = new Set<string>();
const DROPPED_SNAPSHOT_LOG_MAX_KEYS = 100;

const logEventDropped = (
  operationId: string,
  reason: 'not_attached' | 'stale_revision',
  type: string,
  revision?: number,
) => {
  const isTerminal = type === 'done' || type === 'error';
  const key = `${operationId}:${reason}`;
  if (!isTerminal) {
    if (droppedSnapshotLogKeys.has(key)) return;
    if (droppedSnapshotLogKeys.size >= DROPPED_SNAPSHOT_LOG_MAX_KEYS)
      droppedSnapshotLogKeys.clear();
    droppedSnapshotLogKeys.add(key);
  } else {
    droppedSnapshotLogKeys.delete(key);
  }
  void hashGenerationDebugClientValue(operationId).then((operationHash) => {
    logGenerationDebugClientSafe('event_dropped', {
      operationHash,
      reason,
      revision,
      type,
    });
  });
};

export interface ConversationGenerationAction {
  applyConversationGenerationEvent: (event: ConversationGenerationEvent) => void;
  attachConversationGeneration: (operation: ServerGenerationOperation) => void;
  cancelActiveDurableOpsInScope: (options?: ConversationGenerationScope) => Promise<void>;
  cancelAndDetachDurableOps: (options?: ConversationGenerationScope) => Promise<void>;
  detachConversationGeneration: (operationId: string, conversationKey?: string) => void;
  detachDurableOps: (options?: ConversationGenerationScope) => void;
  internal_abortDeferredBrowserLanesForTopic: (
    sessionId: string,
    topicId?: string | null,
  ) => void;
  internal_clearDurableLaneDeferred: (conversationKey: string) => void;
  internal_finalizeDeferredLanePlaceholder: (conversationKey: string) => Promise<void>;
  internal_markDurableGenerating: (id: string, loading: boolean) => void;
  internal_markDurableLaneDeferred: (input: {
    assistantMessageId: string;
    reason: ConversationGenerationDeferReason;
    sessionId: string;
    threadId?: string | null;
    toolName?: string;
    topicId?: string | null;
  }) => void;
  reconcileConversationGeneration: (
    operationId: string,
  ) => Promise<ConversationGenerationOperation | undefined>;
  stopDurableConversationGeneration: (
    options?: ConversationGenerationScope,
  ) => void | Promise<void>;
  syncActiveConversationGenerations: () => Promise<void>;
}

export interface ConversationGenerationScope {
  /** Match every operation targeting a real (non-default) topic across all sessions. */
  allAccountTopics?: boolean;
  allConversations?: boolean;
  /** Match every operation in the session that targets a real (non-default) topic. */
  allSessionTopics?: boolean;
  allThreads?: boolean;
  assistantMessageIds?: string[];
  groupId?: string;
  kind?: ConversationGenerationKind | ConversationGenerationKind[];
  operationId?: string;
  sessionId?: string;
  threadId?: string | null;
  topicId?: string | null;
  /** Match operations whose topic is one of these ids (topic ids are globally unique). */
  topicIds?: string[];
}

const conversationKeyFor = (sessionId?: string | null, topicId?: string | null) =>
  messageMapKey(sessionId || '', topicId);

const findAttachedOperation = (
  serverGenerationOperations: ChatStore['serverGenerationOperations'],
  operationId: string,
) =>
  Object.values(serverGenerationOperations)
    .flatMap((ops) => Object.values(ops))
    .find((item) => item.operationId === operationId);

const visibleConversationThreadId = (state: Pick<ChatStore, 'activeThreadId' | 'portalThreadId'>) =>
  state.portalThreadId ?? state.activeThreadId ?? null;

const shouldApplyAttachedOperation = (
  attached: ServerGenerationOperation | undefined,
  state: ChatStore,
) => {
  if (!attached) return false;
  const accountSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
  if (
    !accountSnapshot ||
    !isAccountMutationCurrent(useUserStore.getState(), accountSnapshot) ||
    attached.userScope !== accountSnapshot.scope
  ) {
    return false;
  }
  if (
    attached.clearGeneration !==
    resolveConversationClearGeneration(
      state,
      attached.sessionId,
      attached.topicId,
      attached.threadId ?? null,
      attached.kind,
    )
  ) {
    return false;
  }
  if (attached.generation !== state.conversationNavigationGeneration) return false;
  return true;
};

const conversationContextFromAttached = (
  attached: Pick<
    ServerGenerationOperation,
    'clearGeneration' | 'generation' | 'sessionId' | 'threadId' | 'topicId'
  >,
): ConversationContext => ({
  clearGeneration: attached.clearGeneration,
  generation: attached.generation,
  sessionId: attached.sessionId,
  threadId: attached.threadId ?? null,
  topicId: attached.topicId,
});

const isSyncAttachableConversationGenerationStatus = (
  status: ConversationGenerationOperation['status'],
) => status === 'pending' || status === 'processing';

const refreshAttachedConversation = async (
  get: () => ChatStore,
  attached?: Pick<
    ServerGenerationOperation,
    'clearGeneration' | 'generation' | 'sessionId' | 'threadId' | 'topicId'
  >,
) => {
  if (attached?.sessionId) {
    await get().refreshMessages(conversationContextFromAttached(attached));
    const snapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (snapshot) {
      await get().refreshTopic({
        accountMutationSnapshot: snapshot,
        containerId: attached.sessionId,
      });
      return;
    }
  }
  await Promise.all([get().refreshMessages(), get().refreshTopic()]);
};

const matchesOperationScope = (
  operation: ServerGenerationOperation,
  options: ConversationGenerationScope | undefined,
  state: ChatStore,
) => {
  if (options?.operationId && operation.operationId !== options.operationId) return false;
  if (options?.allAccountTopics) {
    // Account-wide topic delete: every real-topic operation across sessions,
    // preserving the virtual default topic (null topicId).
    if (!operation.topicId) return false;
  } else if (options?.allSessionTopics) {
    // Session-wide topic delete: every real-topic operation in the session,
    // preserving the virtual default topic (null topicId).
    if (!operation.topicId) return false;
    if (operation.sessionId !== (options?.sessionId ?? state.activeId)) return false;
  } else if (options?.topicIds) {
    // Topic ids are globally unique, so a bulk-delete scope matches by topic
    // alone; operations on the (virtual) default topic have no topicId and are
    // never part of a topic deletion set.
    if (!operation.topicId || !options.topicIds.includes(operation.topicId)) return false;
  } else if (!options?.allConversations) {
    if (operation.sessionId !== (options?.sessionId ?? state.activeId)) return false;
    if ((operation.topicId ?? null) !== (options?.topicId ?? state.activeTopicId ?? null)) {
      return false;
    }
  }
  if (options?.groupId && operation.groupId !== options.groupId) return false;
  if (options?.kind) {
    const kinds = Array.isArray(options.kind) ? options.kind : [options.kind];
    if (!kinds.includes(operation.kind)) return false;
  }
  if (
    options?.assistantMessageIds &&
    (!operation.assistantMessageId ||
      !options.assistantMessageIds.includes(operation.assistantMessageId))
  ) {
    return false;
  }
  if (!options?.allThreads) {
    const threadId =
      options && Object.hasOwn(options, 'threadId')
        ? options.threadId
        : visibleConversationThreadId(state);
    if ((operation.threadId ?? null) !== (threadId ?? null)) return false;
  }
  return true;
};

const matchesActiveServerOperationScope = (
  operation: ConversationGenerationOperation,
  options: ConversationGenerationScope | undefined,
  state: ChatStore,
) => {
  const attachedLike: ServerGenerationOperation = {
    assistantMessageId: operation.assistantMessageId || undefined,
    clearGeneration: 0,
    generation: 0,
    groupId: operation.groupId || undefined,
    kind: operation.kind,
    lane: operation.lane,
    operationId: operation.id,
    sessionId: operation.sessionId || state.activeId,
    threadId: operation.threadId ?? undefined,
    topicId: operation.topicId ?? undefined,
    userScope: '',
  };

  return matchesOperationScope(attachedLike, options, state);
};

const topicExistsInMaps = (
  topicMaps: ChatStore['topicMaps'],
  sessionId: string,
  topicId?: string | null,
) => {
  if (!topicId) return true;
  const topics = topicMaps[sessionId];
  if (topics === undefined) return true;
  if (topics.length === 0) return false;
  return topics.some((topic) => topic.id === topicId);
};

export const conversationGeneration: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ConversationGenerationAction
> = (set, get) => ({
  applyConversationGenerationEvent: (event) => {
    const state = get();
    const attached = findAttachedOperation(state.serverGenerationOperations, event.operationId);
    if (!attached) {
      logEventDropped(event.operationId, 'not_attached', event.type);
      return;
    }
    if (!shouldApplyAttachedOperation(attached, state)) return;
    if (attached.revision !== undefined && event.revision <= attached.revision) {
      logEventDropped(event.operationId, 'stale_revision', event.type, event.revision);
      return;
    }

    set(
      (current) => ({
        serverGenerationOperations: Object.fromEntries(
          Object.entries(current.serverGenerationOperations).map(([key, operations]) => [
            key,
            operations[event.operationId]
              ? {
                  ...operations,
                  [event.operationId]: {
                    ...operations[event.operationId],
                    revision: event.revision,
                  },
                }
              : operations,
          ]),
        ),
      }),
      false,
      n('applyRevision', { operationId: event.operationId, revision: event.revision }),
    );

    const dispatchContext = attached
      ? { sessionId: attached.sessionId, topicId: attached.topicId }
      : undefined;
    const payload = event.payload || {};
    let assistantMessageId = attached?.assistantMessageId;

    if (event.type === 'snapshot') {
      if (payload.assistantMessageId && payload.assistantMessageId !== assistantMessageId) {
        if (assistantMessageId) get().internal_markDurableGenerating(assistantMessageId, false);
        get().internal_markDurableGenerating(payload.assistantMessageId as string, true);
        set(
          (current) => {
            const serverGenerationOperations = { ...current.serverGenerationOperations };
            for (const [key, ops] of Object.entries(serverGenerationOperations)) {
              const currentOp = ops[event.operationId];
              if (!currentOp) continue;
              serverGenerationOperations[key] = {
                ...ops,
                [event.operationId]: {
                  ...currentOp,
                  assistantMessageId: payload.assistantMessageId as string,
                },
              };
            }
            return { serverGenerationOperations };
          },
          false,
          n('applyAssistantId'),
        );
        assistantMessageId = payload.assistantMessageId as string;
      }
      const shouldRefreshMessages =
        Boolean(payload.assistantMessageId) || payload.phase === 'tools' || Boolean(payload.tools);
      if (shouldRefreshMessages) {
        void refreshAttachedConversation(get, attached);
      }
      if (assistantMessageId && (payload.content !== undefined || payload.reasoning)) {
        get().internal_dispatchMessage(
          {
            id: assistantMessageId,
            type: 'updateMessage',
            value: {
              ...(payload.content !== undefined ? { content: payload.content as string } : {}),
              ...(payload.reasoning ? { reasoning: payload.reasoning as any } : {}),
            },
          },
          dispatchContext,
        );
      }
      if (payload.title && payload.topicId) {
        const topicId = payload.topicId as string;
        const title = payload.title as string;
        set(
          (current) => ({
            topicMaps: Object.fromEntries(
              Object.entries(current.topicMaps).map(([containerId, topics]) => [
                containerId,
                topics.map((topic) => (topic.id === topicId ? { ...topic, title } : topic)),
              ]),
            ),
          }),
          false,
          n('applyTitleSnapshot'),
        );
      }
      if (payload.translate && payload.messageId) {
        get().internal_dispatchMessage(
          {
            id: payload.messageId as string,
            key: 'translate',
            type: 'updateMessageExtra',
            value: payload.translate,
          },
          dispatchContext,
        );
      }
    }

    if (event.type === 'done' || event.type === 'error') {
      void hashGenerationDebugClientValue(event.operationId).then((operationHash) => {
        logGenerationDebugClientSafe('event_applied_terminal', {
          operationHash,
          type: event.type,
        });
      });
      if (assistantMessageId) {
        get().internal_markDurableGenerating(assistantMessageId, false);
      }
      if (attached?.groupId) {
        get().internal_toggleSupervisorLoading(false, attached.groupId);
      }
      get().detachConversationGeneration(event.operationId);
      void refreshAttachedConversation(get, attached);
    }
  },

  attachConversationGeneration: (operation) => {
    const state = get();
    const accountSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (
      !accountSnapshot ||
      !isAccountMutationCurrent(useUserStore.getState(), accountSnapshot) ||
      operation.userScope !== accountSnapshot.scope
    ) {
      return;
    }
    const clearGeneration =
      operation.clearGeneration ??
      resolveConversationClearGeneration(
        state,
        operation.sessionId,
        operation.topicId,
        operation.threadId ?? null,
        operation.kind,
      );
    if (
      clearGeneration !==
      resolveConversationClearGeneration(
        state,
        operation.sessionId,
        operation.topicId,
        operation.threadId ?? null,
        operation.kind,
      )
    ) {
      return;
    }

    const attached = {
      ...operation,
      clearGeneration,
      generation: state.conversationNavigationGeneration,
    };
    const key = conversationKeyFor(attached.sessionId, attached.topicId);
    const replaced = Object.values(get().serverGenerationOperations[key] || {}).filter(
      (item) => item.operationId !== attached.operationId && item.lane === attached.lane,
    );
    for (const item of replaced) {
      if (item.assistantMessageId) {
        get().internal_markDurableGenerating(item.assistantMessageId, false);
      }
    }
    set(
      (state) => ({
        serverGenerationOperations: {
          ...state.serverGenerationOperations,
          [key]: {
            ...Object.fromEntries(
              Object.entries(state.serverGenerationOperations[key] || {}).filter(
                ([, item]) => item.lane !== operation.lane,
              ),
            ),
            [attached.operationId]: attached,
          },
        },
      }),
      false,
      n('attach', { operationId: attached.operationId }),
    );
    if (attached.assistantMessageId) {
      get().internal_markDurableGenerating(attached.assistantMessageId, true);
    }
  },

  cancelActiveDurableOpsInScope: async (options) => {
    const state = get();
    // Fence in-flight enqueues AND already-attached operations matching the
    // scope BEFORE the first await. In-flight server operations are invisible
    // to the listActive snapshot below, and an attached operation whose
    // best-effort cancel fails or is lost must stay fenced so a rediscovering
    // sync cannot reattach it.
    set(
      (current) => {
        const withInFlight = recordInFlightEnqueuesForScope(current, {
          allAccountTopics: options?.allAccountTopics,
          allConversations: options?.allConversations,
          allSessionTopics: options?.allSessionTopics,
          allThreads: options?.allThreads,
          kinds: options?.kind
            ? Array.isArray(options.kind)
              ? options.kind
              : [options.kind]
            : undefined,
          sessionId:
            options?.allConversations || options?.allAccountTopics
              ? undefined
              : (options?.sessionId ?? state.activeId),
          threadId:
            options?.allThreads || options?.allConversations
              ? undefined
              : options && Object.hasOwn(options, 'threadId')
                ? options.threadId
                : visibleConversationThreadId(state),
          topicId:
            options?.allConversations ||
            options?.topicIds ||
            options?.allSessionTopics ||
            options?.allAccountTopics
              ? undefined
              : (options?.topicId ?? state.activeTopicId ?? null),
          topicIds: options?.topicIds,
        });
        const attachedInScope = Object.values(current.serverGenerationOperations)
          .flatMap((items) => Object.values(items))
          .filter((operation) => matchesOperationScope(operation, options, current));

        return recordAttachedOperationsStopped(
          { conversationLaneStopMarkers: withInFlight.conversationLaneStopMarkers },
          attachedInScope,
        );
      },
      false,
      n('cancelActive/fenceScopedOperations'),
    );
    try {
      const activeOps = (await conversationGenerationService.listActive({
        quiet: true,
      })) as ConversationGenerationOperation[];
      const scoped = activeOps.filter((operation) =>
        matchesActiveServerOperationScope(operation, options, state),
      );
      if (scoped.length > 0) {
        set(
          (current) => {
            let conversationLaneStopMarkers = current.conversationLaneStopMarkers;
            for (const operation of scoped) {
              const sessionId = operation.sessionId || state.activeId;
              const stoppedOperations = [
                {
                  idempotencyKey: operation.idempotencyKey,
                  lane: operation.lane,
                  laneGeneration: operation.laneGeneration,
                  operationId: operation.id,
                },
              ];
              const nextMarkers = recordStoppedDurableOperationsInMarkers(
                { conversationLaneStopMarkers },
                sessionId,
                stoppedOperations,
                operation.topicId,
                operation.threadId ?? null,
              );
              conversationLaneStopMarkers = nextMarkers.conversationLaneStopMarkers;
            }
            return { conversationLaneStopMarkers };
          },
          false,
          n('cancelActive/recordStoppedMarkers'),
        );
      }
      await Promise.allSettled(
        scoped.map((operation) => conversationGenerationService.cancel(operation.id)),
      );
    } catch {
      // Best-effort server cancel for detached durable ops.
    }
    await get().cancelAndDetachDurableOps(options);
  },

  cancelAndDetachDurableOps: async (options) => {
    const state = get();
    const operations = Object.values(state.serverGenerationOperations)
      .flatMap((items) => Object.values(items))
      .filter((operation) => matchesOperationScope(operation, options, state));

    await Promise.allSettled(
      operations.map((operation) => conversationGenerationService.cancel(operation.operationId)),
    );
    for (const operation of operations) {
      if (operation.assistantMessageId) {
        get().internal_markDurableGenerating(operation.assistantMessageId, false);
      }
      if (operation.groupId) {
        get().internal_toggleSupervisorLoading(false, operation.groupId);
      }
      get().detachConversationGeneration(operation.operationId);
    }
  },

  detachConversationGeneration: (operationId, conversationKey) => {
    set(
      (state) => {
        const serverGenerationOperations = { ...state.serverGenerationOperations };
        const keys = conversationKey ? [conversationKey] : Object.keys(serverGenerationOperations);
        for (const key of keys) {
          const current = serverGenerationOperations[key];
          if (!current?.[operationId]) continue;
          const remaining = { ...current };
          delete remaining[operationId];
          if (Object.keys(remaining).length === 0) delete serverGenerationOperations[key];
          else serverGenerationOperations[key] = remaining;
        }
        return { serverGenerationOperations };
      },
      false,
      n('detach', { operationId }),
    );
  },

  detachDurableOps: (options) => {
    const state = get();
    const operations = Object.values(state.serverGenerationOperations)
      .flatMap((items) => Object.values(items))
      .filter((operation) => matchesOperationScope(operation, options, state));

    for (const operation of operations) {
      if (operation.assistantMessageId) {
        get().internal_markDurableGenerating(operation.assistantMessageId, false);
      }
      if (operation.groupId) {
        get().internal_toggleSupervisorLoading(false, operation.groupId);
      }
      get().detachConversationGeneration(operation.operationId);
    }
  },

  internal_markDurableGenerating: (id, loading) => {
    set(
      {
        chatLoadingIds: toggleBooleanList(get().chatLoadingIds, id, loading),
      },
      false,
      n(loading ? 'generating/start' : 'generating/end', { id }),
    );
  },

  internal_markDurableLaneDeferred: ({
    assistantMessageId,
    reason,
    sessionId,
    threadId,
    toolName,
    topicId,
  }) => {
    const conversationKey = deferredBrowserGenerationLaneKey(sessionId, topicId, threadId);
    set(
      (state) => ({
        deferredBrowserGenerationLanes: {
          ...state.deferredBrowserGenerationLanes,
          [conversationKey]: { assistantMessageId, reason, threadId: threadId ?? null, toolName },
        },
      }),
      false,
      n('deferredLane/mark', { conversationKey, reason }),
    );
    void hashGenerationDebugClientValue(assistantMessageId).then((messageHash) => {
      logGenerationDebugClientSafe('deferred_lane_marked', {
        messageHash,
        reason,
        toolName,
      });
    });
  },

  internal_clearDurableLaneDeferred: (conversationKey) => {
    set(
      (state) => {
        if (!state.deferredBrowserGenerationLanes[conversationKey]) return state;
        const deferredBrowserGenerationLanes = { ...state.deferredBrowserGenerationLanes };
        delete deferredBrowserGenerationLanes[conversationKey];
        return { deferredBrowserGenerationLanes };
      },
      false,
      n('deferredLane/clear', { conversationKey }),
    );
  },

  internal_abortDeferredBrowserLanesForTopic: (sessionId, topicId) => {
    const keys = deferredBrowserGenerationLaneKeysForTopic(
      get().deferredBrowserGenerationLanes,
      sessionId,
      topicId,
    );
    if (keys.length === 0) return;

    const ids = new Set<string>();
    for (const key of keys) {
      const assistantMessageId = get().deferredBrowserGenerationLanes[key]?.assistantMessageId;
      if (assistantMessageId) ids.add(assistantMessageId);
    }
    for (const messageId of ids) {
      const laneKey = get().chatLoadingLaneByMessageId[messageId];
      if (laneKey) {
        get().chatLoadingAbortControllersByLane[laneKey]?.abort(MESSAGE_CANCEL_FLAT);
      }
      get().internal_toggleChatLoading(false, messageId, n('deferredLane/abortTopic') as string);
    }
    for (const key of keys) {
      get().internal_clearDurableLaneDeferred(key);
    }
  },

  internal_finalizeDeferredLanePlaceholder: async (conversationKey) => {
    const deferred = get().deferredBrowserGenerationLanes[conversationKey];
    if (!deferred) return;
    if (
      get().chatLoadingIds.includes(deferred.assistantMessageId) ||
      get().messageInToolsCallingIds.includes(deferred.assistantMessageId) ||
      get().toolCallingStreamIds[deferred.assistantMessageId]
    ) {
      return;
    }

    // Never clear loading on a leftover LOADING_FLAT row: that is the white
    // circle. Only drop the marker after persist wrote real content.
    const mapKey = conversationKeyFor(get().activeId, get().activeTopicId);
    const message = (get().messagesMap[mapKey] || []).find(
      (item) => item.id === deferred.assistantMessageId && item.role === 'assistant',
    );
    if (!message || message.content === LOADING_FLAT) return;

    get().internal_clearDurableLaneDeferred(conversationKey);
    void hashGenerationDebugClientValue(deferred.assistantMessageId).then((messageHash) => {
      logGenerationDebugClientSafe('deferred_placeholder_finalized', {
        messageHash,
        reason: deferred.reason,
        toolName: deferred.toolName,
      });
    });
  },

  reconcileConversationGeneration: async (operationId) => {
    const existingAttached = findAttachedOperation(get().serverGenerationOperations, operationId);
    if (
      existingAttached &&
      (existingAttached.generation !== get().conversationNavigationGeneration ||
        existingAttached.clearGeneration !==
          resolveConversationClearGeneration(
            get(),
            existingAttached.sessionId,
            existingAttached.topicId,
            existingAttached.threadId ?? null,
            existingAttached.kind,
          ))
    ) {
      get().attachConversationGeneration(existingAttached);
    }
    const operation = (await conversationGenerationService.getOperation(
      operationId,
    )) as ConversationGenerationOperation;
    const attached = findAttachedOperation(get().serverGenerationOperations, operationId);
    if (operation.status === 'cancelling') {
      if (attached?.assistantMessageId) {
        get().internal_markDurableGenerating(attached.assistantMessageId, false);
      }
      if (attached?.groupId) {
        get().internal_toggleSupervisorLoading(false, attached.groupId);
      }
      get().detachConversationGeneration(operationId);
      return operation;
    }
    if (isSyncAttachableConversationGenerationStatus(operation.status)) return operation;

    if (attached?.assistantMessageId) {
      get().internal_markDurableGenerating(attached.assistantMessageId, false);
    }
    if (attached?.groupId) {
      get().internal_toggleSupervisorLoading(false, attached.groupId);
    }
    get().detachConversationGeneration(operationId);
    await refreshAttachedConversation(
      get,
      attached ??
        (operation.sessionId
          ? {
              clearGeneration: resolveConversationClearGeneration(
                get(),
                operation.sessionId,
                operation.topicId,
                operation.threadId ?? null,
              ),
              generation: get().conversationNavigationGeneration,
              sessionId: operation.sessionId,
              threadId: operation.threadId ?? undefined,
              topicId: operation.topicId ?? undefined,
            }
          : undefined),
    );
    return operation;
  },

  stopDurableConversationGeneration: (options) =>
    get().cancelActiveDurableOpsInScope({
      ...options,
      kind: options?.kind ?? ConversationGenerationChatFamilyKinds,
    }),

  syncActiveConversationGenerations: async () => {
    const operations = (await conversationGenerationService.listActive()) as Array<
      ConversationGenerationOperation & { assistantMessageId?: string | null }
    >;
    const { activeId, activeTopicId, conversationNavigationGeneration, topicMaps } = get();
    const accountSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const currentScope = accountSnapshot?.scope;
    const visibleThreadId = visibleConversationThreadId(get());
    const activeOperationIds = new Set<string>();
    let attachedCount = 0;
    let fencedCancelCount = 0;
    for (const operation of operations) {
      const operationSessionId = operation.sessionId || activeId;
      if (
        isDurableIdempotencyKeyStopped(get(), operation.idempotencyKey) ||
        isConversationLaneDurableGenerationStopped(
          get(),
          operationSessionId,
          operation.topicId,
          operation.threadId ?? null,
          {
            idempotencyKey: operation.idempotencyKey,
            lane: operation.lane,
            laneGeneration: operation.laneGeneration,
            operationId: operation.id,
          },
        ) ||
        isConversationTopicDurableGenerationStopped(get(), operationSessionId, operation.topicId, {
          idempotencyKey: operation.idempotencyKey,
          lane: operation.lane,
          laneGeneration: operation.laneGeneration,
          operationId: operation.id,
        })
      ) {
        if (isSyncAttachableConversationGenerationStatus(operation.status)) {
          fencedCancelCount += 1;
          await conversationGenerationService.cancel(operation.id).catch(() => undefined);
        }
        continue;
      }
      if (
        operationSessionId === activeId &&
        (operation.topicId ?? null) === (activeTopicId ?? null) &&
        (operation.threadId ?? null) === visibleThreadId
      ) {
        activeOperationIds.add(operation.id);
        if (
          !currentScope ||
          !isSyncAttachableConversationGenerationStatus(operation.status) ||
          !topicExistsInMaps(topicMaps, operationSessionId, operation.topicId)
        ) {
          continue;
        }
        const operationClearGeneration = resolveConversationClearGeneration(
          get(),
          operationSessionId,
          operation.topicId,
          operation.threadId ?? null,
          operation.kind,
        );
        get().attachConversationGeneration({
          assistantMessageId: operation.assistantMessageId || undefined,
          clearGeneration: operationClearGeneration,
          generation: conversationNavigationGeneration,
          groupId: operation.groupId || undefined,
          kind: operation.kind,
          lane: operation.lane,
          laneGeneration: operation.laneGeneration,
          operationId: operation.id,
          revision: operation.revision,
          sessionId: operationSessionId,
          threadId: operation.threadId || undefined,
          topicId: operation.topicId || undefined,
          userScope: currentScope,
        });
        attachedCount += 1;
        if (operation.kind === 'group_supervisor' && operation.groupId) {
          get().internal_toggleSupervisorLoading(true, operation.groupId);
        }
      }
    }

    const attachedForCurrentLane = Object.values(
      get().serverGenerationOperations[conversationKeyFor(activeId, activeTopicId)] || {},
    ).filter((operation) => (operation.threadId ?? null) === visibleThreadId);
    let detachedTerminal = false;
    let detachedCount = 0;
    for (const operation of attachedForCurrentLane) {
      if (activeOperationIds.has(operation.operationId)) continue;
      detachedTerminal = true;
      detachedCount += 1;
      if (operation.assistantMessageId) {
        get().internal_markDurableGenerating(operation.assistantMessageId, false);
      }
      get().detachConversationGeneration(operation.operationId);
    }
    if (detachedTerminal) {
      await Promise.all([get().refreshMessages(), get().refreshTopic()]);
    }

    // Orphan cleanup runs whether or not something detached: the dead row may
    // belong to the turn whose local operation was just detached above. A
    // browser-run turn interrupted before producing content (Stop, closed tab,
    // or a pre-fix client that dropped a finished reply on navigation) leaves a
    // `...` row with no live producer, rendered as a dead empty bubble forever.
    // Remove it once old enough that no live producer can still finalize it.
    const visibleMessages = get().messagesMap[conversationKeyFor(activeId, activeTopicId)] || [];
    const attachedAssistantIds = new Set(
      Object.values(
        get().serverGenerationOperations[conversationKeyFor(activeId, activeTopicId)] || {},
      )
        .filter((operation) => (operation.threadId ?? null) === visibleThreadId)
        .map((operation) => operation.assistantMessageId)
        .filter((id): id is string => !!id),
    );
    const orphanedPlaceholders = visibleMessages.filter(
      (message) =>
        message.role === 'assistant' &&
        message.content === LOADING_FLAT &&
        // a row carrying tool calls is a mid-tool turn, not a dead placeholder
        !(message.tools && message.tools.length > 0) &&
        !get().chatLoadingIds.includes(message.id) &&
        !get().messageInToolsCallingIds.includes(message.id) &&
        !get().toolCallingStreamIds[message.id] &&
        !attachedAssistantIds.has(message.id) &&
        typeof message.createdAt === 'number' &&
        Date.now() - message.createdAt > ORPHAN_PLACEHOLDER_GRACE_MS,
    );
    for (const placeholder of orphanedPlaceholders) {
      logGenerationDebugClientSafe('orphan_deleted', {
        ageMs:
          typeof placeholder.createdAt === 'number'
            ? Math.max(0, Date.now() - placeholder.createdAt)
            : undefined,
        messageHash: await hashGenerationDebugClientValue(placeholder.id),
      });
      await get()
        .internal_deleteMessage(placeholder.id)
        .catch(() => undefined);
    }
    if (orphanedPlaceholders.length > 0) {
      await Promise.all([get().refreshMessages(), get().refreshTopic()]);
    } else if (!detachedTerminal) {
      const hasLoadingPlaceholder = visibleMessages.some(
        (message) => message.role === 'assistant' && message.content === LOADING_FLAT,
      );
      if (hasLoadingPlaceholder && activeOperationIds.size === 0) {
        await Promise.all([get().refreshMessages(), get().refreshTopic()]);
      }
    }

    const currentConversationKey = deferredBrowserGenerationLaneKey(
      activeId,
      activeTopicId,
      visibleThreadId,
    );
    const deferredLane = get().deferredBrowserGenerationLanes[currentConversationKey];
    if (deferredLane) {
      const deferredMessage = visibleMessages.find(
        (message) => message.id === deferredLane.assistantMessageId && message.role === 'assistant',
      );
      const deferredStillProducing =
        get().chatLoadingIds.includes(deferredLane.assistantMessageId) ||
        get().messageInToolsCallingIds.includes(deferredLane.assistantMessageId) ||
        Boolean(get().toolCallingStreamIds[deferredLane.assistantMessageId]) ||
        attachedAssistantIds.has(deferredLane.assistantMessageId);
      const hasPendingTools =
        Boolean(deferredMessage?.tools && deferredMessage.tools.length > 0) &&
        !visibleMessages.some(
          (message) =>
            message.role === 'tool' && message.parentId === deferredLane.assistantMessageId,
        );
      if (!deferredStillProducing && hasPendingTools) {
        get().internal_toggleMessageInToolsCalling(true, deferredLane.assistantMessageId);
        await get()
          .triggerToolCalls(deferredLane.assistantMessageId, {
            inPortalThread: Boolean(get().portalThreadId),
            threadId: visibleThreadId ?? undefined,
          })
          .catch(console.error);
      } else if (
        !deferredStillProducing &&
        deferredMessage &&
        deferredMessage.content !== LOADING_FLAT
      ) {
        await get().internal_finalizeDeferredLanePlaceholder(currentConversationKey);
      }
    }

    logGenerationDebugClientSafe('sync_summary', {
      activeCount: operations.length,
      attachedCount,
      detachedCount,
      fencedCancelCount,
      orphanDeleted: orphanedPlaceholders.length,
    });
  },
});
