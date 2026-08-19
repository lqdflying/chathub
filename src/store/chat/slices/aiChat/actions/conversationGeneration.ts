import { LOADING_FLAT } from '@lobechat/const';
import {
  ConversationGenerationChatFamilyKinds,
  isActiveConversationGenerationStatus,
  type ConversationGenerationEvent,
  type ConversationGenerationKind,
  type ConversationGenerationOperation,
} from '@lobechat/types';
import { StateCreator } from 'zustand/vanilla';

import { conversationGenerationService } from '@/services/conversationGeneration';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import type { ChatStore } from '@/store/chat/store';
import type { ConversationContext } from '@/store/chat/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { toggleBooleanList } from '@/store/chat/utils';
import { useUserStore } from '@/store/user';
import { setNamespace } from '@/utils/storeDebug';

import type { ServerGenerationOperation } from '../../topic/initialState';

const n = setNamespace('durableGeneration');

export interface ConversationGenerationAction {
  applyConversationGenerationEvent: (event: ConversationGenerationEvent) => void;
  attachConversationGeneration: (operation: ServerGenerationOperation) => void;
  cancelAndDetachDurableOps: (options?: ConversationGenerationScope) => Promise<void>;
  detachDurableOps: (options?: ConversationGenerationScope) => void;
  detachConversationGeneration: (operationId: string, conversationKey?: string) => void;
  internal_markDurableGenerating: (id: string, loading: boolean) => void;
  reconcileConversationGeneration: (
    operationId: string,
  ) => Promise<ConversationGenerationOperation | undefined>;
  stopDurableConversationGeneration: (options?: ConversationGenerationScope) => void | Promise<void>;
  syncActiveConversationGenerations: () => Promise<void>;
}

interface ConversationGenerationScope {
  allConversations?: boolean;
  allThreads?: boolean;
  assistantMessageIds?: string[];
  groupId?: string;
  kind?: ConversationGenerationKind | ConversationGenerationKind[];
  operationId?: string;
  sessionId?: string;
  threadId?: string | null;
  topicId?: string | null;
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
  if (attached.clearGeneration !== state.conversationClearGeneration) return false;
  if (attached.generation !== state.conversationNavigationGeneration) return false;
  return true;
};

const conversationContextFromAttached = (
  attached: Pick<ServerGenerationOperation, 'clearGeneration' | 'generation' | 'sessionId' | 'topicId'>,
): ConversationContext => ({
  clearGeneration: attached.clearGeneration,
  generation: attached.generation,
  sessionId: attached.sessionId,
  topicId: attached.topicId,
});

const refreshAttachedConversation = async (
  get: () => ChatStore,
  attached?: Pick<ServerGenerationOperation, 'generation' | 'sessionId' | 'topicId'>,
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
  if (!options?.allConversations) {
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
  if (options?.assistantMessageIds) {
    if (
      !operation.assistantMessageId ||
      !options.assistantMessageIds.includes(operation.assistantMessageId)
    ) {
      return false;
    }
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

export const conversationGeneration: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ConversationGenerationAction
> = (set, get) => ({
  applyConversationGenerationEvent: (event) => {
    const state = get();
    const attached = findAttachedOperation(state.serverGenerationOperations, event.operationId);
    if (!shouldApplyAttachedOperation(attached, state)) return;
    if (attached?.revision !== undefined && event.revision <= attached.revision) return;

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
        Boolean(payload.assistantMessageId) ||
        payload.phase === 'tools' ||
        Boolean(payload.tools);
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
    const clearGeneration = operation.clearGeneration ?? state.conversationClearGeneration;
    if (clearGeneration !== state.conversationClearGeneration) return;

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

  internal_markDurableGenerating: (id, loading) => {
    set(
      {
        chatLoadingIds: toggleBooleanList(get().chatLoadingIds, id, loading),
      },
      false,
      n(loading ? 'generating/start' : 'generating/end', { id }),
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

  reconcileConversationGeneration: async (operationId) => {
    const existingAttached = findAttachedOperation(get().serverGenerationOperations, operationId);
    if (
      existingAttached &&
      (existingAttached.generation !== get().conversationNavigationGeneration ||
        existingAttached.clearGeneration !== get().conversationClearGeneration)
    ) {
      get().attachConversationGeneration(existingAttached);
    }
    const operation = (await conversationGenerationService.getOperation(
      operationId,
    )) as ConversationGenerationOperation;
    const attached = findAttachedOperation(get().serverGenerationOperations, operationId);
    if (isActiveConversationGenerationStatus(operation.status)) return operation;

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
              clearGeneration: get().conversationClearGeneration,
              generation: get().conversationNavigationGeneration,
              sessionId: operation.sessionId,
              topicId: operation.topicId,
            }
          : undefined),
    );
    return operation;
  },

  stopDurableConversationGeneration: (options) =>
    get().cancelAndDetachDurableOps({
      ...options,
      kind: options?.kind ?? ConversationGenerationChatFamilyKinds,
    }),

  syncActiveConversationGenerations: async () => {
    const operations = (await conversationGenerationService.listActive()) as Array<
      ConversationGenerationOperation & { assistantMessageId?: string | null }
    >;
    const { activeId, activeTopicId, conversationClearGeneration, conversationNavigationGeneration } =
      get();
    const accountSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const currentScope = accountSnapshot?.scope;
    const visibleThreadId = visibleConversationThreadId(get());
    const activeOperationIds = new Set<string>();
    for (const operation of operations) {
      if (
        (operation.sessionId || activeId) === activeId &&
        (operation.topicId ?? null) === (activeTopicId ?? null) &&
        (operation.threadId ?? null) === visibleThreadId
      ) {
        activeOperationIds.add(operation.id);
        if (!currentScope) continue;
        get().attachConversationGeneration({
          assistantMessageId: operation.assistantMessageId || undefined,
          clearGeneration: conversationClearGeneration,
          generation: conversationNavigationGeneration,
          groupId: operation.groupId || undefined,
          kind: operation.kind,
          lane: operation.lane,
          laneGeneration: operation.laneGeneration,
          operationId: operation.id,
          revision: operation.revision,
          sessionId: operation.sessionId || activeId,
          threadId: operation.threadId || undefined,
          topicId: operation.topicId || undefined,
          userScope: currentScope,
        });
        if (operation.kind === 'group_supervisor' && operation.groupId) {
          get().internal_toggleSupervisorLoading(true, operation.groupId);
        }
      }
    }

    const attachedForCurrentLane = Object.values(
      get().serverGenerationOperations[conversationKeyFor(activeId, activeTopicId)] || {},
    ).filter((operation) => (operation.threadId ?? null) === visibleThreadId);
    let detachedTerminal = false;
    for (const operation of attachedForCurrentLane) {
      if (activeOperationIds.has(operation.operationId)) continue;
      detachedTerminal = true;
      if (operation.assistantMessageId) {
        get().internal_markDurableGenerating(operation.assistantMessageId, false);
      }
      get().detachConversationGeneration(operation.operationId);
    }
    if (detachedTerminal) {
      await Promise.all([get().refreshMessages(), get().refreshTopic()]);
    } else {
      const visibleMessages =
        get().messagesMap[conversationKeyFor(activeId, activeTopicId)] || [];
      const hasLoadingPlaceholder = visibleMessages.some(
        (message) => message.role === 'assistant' && message.content === LOADING_FLAT,
      );
      if (hasLoadingPlaceholder && activeOperationIds.size === 0) {
        await Promise.all([get().refreshMessages(), get().refreshTopic()]);
      }
    }
  },
});
