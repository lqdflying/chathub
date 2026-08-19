/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Note: To make the code more logic and readable, we just disable the auto sort key eslint rule
// DON'T REMOVE THE FIRST LINE
import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { chainSummaryTitle } from '@lobechat/prompts';
import { TraceNameMap, UIChatMessage } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import { produce } from 'immer';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { message } from '@/components/AntdStaticMethods';
import { LOADING_FLAT } from '@/const/message';
import { conversationGenerationRequestKey } from '@/helpers/conversationGenerationIdempotency';
import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { chatService } from '@/services/chat';
import { tryEnqueueConversationGeneration } from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { CreateTopicParams } from '@/services/topic/type';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import type { AccountMutationSnapshot } from '@/store/accountMutation';
import type { ChatStore } from '@/store/chat';
import type { ChatStoreState } from '@/store/chat/initialState';
import {
  bumpTopicScopedClearGeneration,
  laneScopedClearKey,
  markConversationTopicDurableGenerationStopped,
  resolveConversationClearGeneration,
  trackDurableEnqueue,
  untrackDurableEnqueue,
} from '@/store/chat/utils/conversationClearGeneration';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { enqueueTitleSummaryPersistence } from '@/store/chat/utils/titleSummaryOperation';
import { globalHelpers } from '@/store/global/helpers';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, systemAgentSelectors } from '@/store/user/selectors';
import { ChatTopic } from '@/types/topic';
import { normalizeTopic } from '@/utils/client/topic';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { chatSelectors } from '../message/selectors';
import { ChatTopicDispatch, topicReducer } from './reducer';
import { topicSelectors } from './selectors';

const n = setNamespace('t');

const SWR_USE_FETCH_TOPIC = 'SWR_USE_FETCH_TOPIC';
const SWR_USE_SEARCH_TOPIC = 'SWR_USE_SEARCH_TOPIC';

const topicLoadingOperations = new Map<string, Set<string>>();

const getTopicLoadingOperationKey = (
  scope: string,
  ownershipInvalidationGeneration: number,
  conversationClearGeneration: number,
  conversationNavigationGeneration: number,
  containerId: string,
  topicId: string,
): string =>
  `${scope}:${ownershipInvalidationGeneration}:${conversationClearGeneration}:${conversationNavigationGeneration}:${containerId}:${topicId}`;

const acquireTopicLoadingOperation = (loadingOperationKey: string, operationId: string): void => {
  const operations = topicLoadingOperations.get(loadingOperationKey) ?? new Set<string>();
  operations.add(operationId);
  topicLoadingOperations.set(loadingOperationKey, operations);
};

const releaseTopicLoadingOperation = (loadingOperationKey: string, operationId: string): void => {
  const operations = topicLoadingOperations.get(loadingOperationKey);
  if (!operations?.delete(operationId)) return;
  if (operations.size > 0) return;

  topicLoadingOperations.delete(loadingOperationKey);
};

const hasTopicLoadingOperation = (loadingOperationKey: string): boolean => {
  return (topicLoadingOperations.get(loadingOperationKey)?.size ?? 0) > 0;
};

const hasCurrentTopicLoadingOperation = (
  state: Pick<
    ChatStore,
    'activeId' | 'conversationClearGeneration' | 'conversationNavigationGeneration'
  >,
  topicId: string,
): boolean => {
  const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
  if (!accountMutationSnapshot || !state.activeId) return true;

  const loadingOperationKey = getTopicLoadingOperationKey(
    accountMutationSnapshot.scope,
    accountMutationSnapshot.ownershipInvalidationGeneration,
    state.conversationClearGeneration,
    state.conversationNavigationGeneration,
    state.activeId,
    topicId,
  );

  return hasTopicLoadingOperation(loadingOperationKey);
};

interface TopicRefreshContext {
  accountMutationSnapshot: AccountMutationSnapshot;
  containerId: string;
}

export interface ChatTopicAction {
  favoriteTopic: (id: string, favState: boolean) => Promise<void>;
  openNewTopicOrSaveTopic: () => Promise<void>;
  refreshTopic: (context?: TopicRefreshContext) => Promise<void>;
  removeAllTopics: () => Promise<void>;
  removeSessionTopics: () => Promise<void>;
  removeGroupTopics: (groupId: string) => Promise<void>;
  removeTopic: (id: string) => Promise<void>;
  removeUnstarredTopic: () => Promise<void>;
  saveToTopic: (sessionId?: string, groupId?: string) => Promise<string | undefined>;
  createTopic: (
    sessionId?: string,
    groupId?: string,
    expectedConversationVersion?: number,
  ) => Promise<string | undefined>;

  autoRenameTopicTitle: (id: string) => Promise<void>;
  duplicateTopic: (id: string) => Promise<void>;
  summaryTopicTitle: (topicId: string, messages: UIChatMessage[]) => Promise<void>;
  switchTopic: (id?: string, skipRefreshMessage?: boolean) => Promise<void>;
  updateTopicTitle: (id: string, title: string) => Promise<void>;
  useFetchTopics: (
    enable: boolean,
    sessionId?: string,
    groupId?: string,
  ) => SWRResponse<ChatTopic[]>;
  useSearchTopics: (
    keywords?: string,
    sessionId?: string,
    groupId?: string,
  ) => SWRResponse<ChatTopic[]>;

  internal_updateTopicTitleInSummary: (id: string, title: string) => void;
  internal_updateTopicLoading: (id: string, loading: boolean) => void;
  internal_createTopic: (
    params: CreateTopicParams,
    expectedConversationVersion?: number,
  ) => Promise<string | undefined>;
  internal_updateTopic: (id: string, data: Partial<ChatTopic>) => Promise<void>;
  internal_dispatchTopic: (payload: ChatTopicDispatch, action?: any) => void;
}

export const chatTopic: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatTopicAction
> = (set, get) => ({
  // create
  openNewTopicOrSaveTopic: async () => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const { switchTopic, saveToTopic, refreshMessages, activeTopicId } = get();
    const hasTopic = !!activeTopicId;

    if (hasTopic) switchTopic();
    else {
      await saveToTopic();
      if (isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot)) {
        await refreshMessages();
      }
    }
  },

  createTopic: async (sessionId, groupId, expectedConversationVersion) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const { activeId, activeSessionType, internal_createTopic } = get();
    if (!accountMutationSnapshot || !activeId) return;
    const creatingTopicId = `topic-create-${nanoid(8)}`;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === activeId;
    const clearCurrentTopicCreation = () => {
      if (get().creatingTopicId !== creatingTopicId) return;

      set({ creatingTopic: false, creatingTopicId: undefined }, false, n('creatingTopic/end'));
    };

    const messages = chatSelectors.activeBaseChats(get());

    set({ creatingTopic: true, creatingTopicId }, false, n('creatingTopic/start'));
    const topicId = await internal_createTopic(
      {
        title: t('defaultTitle', { ns: 'topic' }),
        messages: messages.map((m) => m.id),
        ...(activeSessionType === 'group'
          ? { groupId: groupId || activeId }
          : { sessionId: sessionId || activeId }),
      },
      expectedConversationVersion,
    );
    if (!isCurrentRequest()) {
      clearCurrentTopicCreation();
      return;
    }

    clearCurrentTopicCreation();

    return topicId;
  },

  saveToTopic: async (sessionId, groupId) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    // if there is no message, stop
    const messages = chatSelectors.activeBaseChats(get());
    if (messages.length === 0) return;

    const { activeId, activeSessionType, summaryTopicTitle, internal_createTopic } = get();
    const requestedGeneration = get().conversationClearGeneration;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === activeId;

    // 1. create topic and bind these messages
    const topicId = await internal_createTopic({
      title: t('defaultTitle', { ns: 'topic' }),
      messages: messages.map((m) => m.id),
      ...(activeSessionType === 'group'
        ? { groupId: groupId || activeId }
        : { sessionId: sessionId || activeId }),
    });
    if (!topicId || !isCurrentRequest()) return;

    get().internal_updateTopicLoading(topicId, true);
    // 2. auto summary topic Title
    // we don't need to wait for summary, just let it run async
    summaryTopicTitle(topicId, messages);

    // Clear supervisor todos for temporary topic in current container after saving
    try {
      const { activeId, activeSessionType } = get();
      let isGroupSession = activeSessionType === 'group';
      if (activeSessionType === undefined) {
        const sessionStore = useSessionStore.getState();
        isGroupSession = sessionSelectors.isCurrentSessionGroupSession(sessionStore);
      }

      if (isGroupSession) {
        set(
          produce((state: ChatStoreState) => {
            state.supervisorTodos[messageMapKey(groupId || activeId, null)] = [];
          }),
          false,
          n('resetSupervisorTodosOnSaveToTopic', { groupId: groupId || activeId }),
        );
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to reset supervisor todos on save to topic:', error);
      }
    }

    return topicId;
  },

  duplicateTopic: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedContainerId = get().activeId;
    if (!accountMutationSnapshot || !requestedContainerId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedContainerId;

    const expectedConversationVersion = await messageService.getConversationVersion();
    if (!isCurrentRequest()) return;

    const topic = topicSelectors.getTopicById(id)(get());
    if (!topic) return;

    const newTitle = t('duplicateTitle', { ns: 'chat', title: topic?.title });
    const loadingMessageKey = `duplicateTopic-${requestedGeneration}-${id}`;

    message.loading({
      content: t('duplicateLoading', { ns: 'topic' }),
      key: loadingMessageKey,
      duration: 0,
    });

    let newTopicId: string;
    try {
      newTopicId = await topicService.cloneTopic(id, newTitle, {
        expectedConversationVersion,
      });
    } finally {
      if (isCurrentRequest()) message.destroy(loadingMessageKey);
    }
    if (!isCurrentRequest()) return;

    await get().refreshTopic();
    if (!isCurrentRequest()) return;

    message.success(t('duplicateSuccess', { ns: 'topic' }));

    await get().switchTopic(newTopicId);
  },
  // update
  summaryTopicTitle: async (topicId, messages) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedContainerId = get().activeId;
    if (!accountMutationSnapshot || !requestedContainerId) return;
    const requestedScope = accountMutationSnapshot.scope;

    const topic = get().topicMaps[requestedContainerId]?.find((item) => item.id === topicId);
    if (!topic) return;

    const previousOperation = get().topicTitleSummaryOperations[topicId];
    previousOperation?.abortController.abort();
    if (previousOperation) {
      releaseTopicLoadingOperation(
        previousOperation.loadingOperationKey,
        previousOperation.operationId,
      );
    }

    const operationId = `topic-summary-${nanoid(8)}`;
    const abortController = new AbortController();
    const originalTitle = previousOperation?.originalTitle ?? topic.title;
    const loadingOperationKey = getTopicLoadingOperationKey(
      accountMutationSnapshot.scope,
      accountMutationSnapshot.ownershipInvalidationGeneration,
      requestedGeneration,
      get().conversationNavigationGeneration,
      requestedContainerId,
      topicId,
    );
    const isCurrentTopicRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedContainerId &&
      get().topicTitleSummaryOperations[topicId]?.operationId === operationId;
    const updateOwnedTitle = (title: string) => {
      set(
        (state) => {
          const operation = state.topicTitleSummaryOperations[topicId];
          if (operation?.operationId !== operationId) return state;

          const topics = state.topicMaps[requestedContainerId] || [];
          return {
            topicMaps: {
              ...state.topicMaps,
              [requestedContainerId]: topics.map((item) =>
                item.id === topicId ? { ...item, title } : item,
              ),
            },
            topicTitleSummaryOperations: {
              ...state.topicTitleSummaryOperations,
              [topicId]: { ...operation, displayedTitle: title },
            },
          };
        },
        false,
        n('summaryTopicTitle/update', { operationId, requestedContainerId, topicId }),
      );
    };
    const finishOwnedOperation = (restoreOriginalTitle: boolean) => {
      releaseTopicLoadingOperation(loadingOperationKey, operationId);
      const shouldClearLoading = !hasCurrentTopicLoadingOperation(get(), topicId);
      set(
        (state) => {
          const operation = state.topicTitleSummaryOperations[topicId];
          if (operation?.operationId !== operationId) {
            if (!shouldClearLoading || !state.topicLoadingIds.includes(topicId)) return state;

            return {
              topicLoadingIds: state.topicLoadingIds.filter((id) => id !== topicId),
            };
          }

          const nextOperations = { ...state.topicTitleSummaryOperations };
          delete nextOperations[topicId];

          const topics = state.topicMaps[requestedContainerId] || [];
          const nextTopics = restoreOriginalTitle
            ? topics.map((item) =>
                item.id === topicId && item.title === operation.displayedTitle
                  ? { ...item, title: operation.originalTitle }
                  : item,
              )
            : topics;

          return {
            topicLoadingIds: shouldClearLoading
              ? state.topicLoadingIds.filter((id) => id !== topicId)
              : state.topicLoadingIds,
            topicMaps:
              nextTopics === topics
                ? state.topicMaps
                : { ...state.topicMaps, [requestedContainerId]: nextTopics },
            topicTitleSummaryOperations: nextOperations,
          };
        },
        false,
        n('summaryTopicTitle/finish', { operationId, requestedContainerId, topicId }),
      );
    };

    acquireTopicLoadingOperation(loadingOperationKey, operationId);
    set(
      (state) => ({
        topicLoadingIds: state.topicLoadingIds.includes(topicId)
          ? state.topicLoadingIds
          : [...state.topicLoadingIds, topicId],
        topicMaps: {
          ...state.topicMaps,
          [requestedContainerId]: (state.topicMaps[requestedContainerId] || []).map((item) =>
            item.id === topicId ? { ...item, title: LOADING_FLAT } : item,
          ),
        },
        topicTitleSummaryOperations: {
          ...state.topicTitleSummaryOperations,
          [topicId]: {
            abortController,
            containerId: requestedContainerId,
            displayedTitle: LOADING_FLAT,
            loadingOperationKey,
            operationId,
            originalTitle,
          },
        },
      }),
      false,
      n('summaryTopicTitle/start', { operationId, requestedContainerId, topicId }),
    );

    let output = '';
    let didResolveTitle = false;

    // Get current agent for topic
    const topicConfig = systemAgentSelectors.topic(useUserStore.getState());

    if (
      isClientDurableConversationGenerationEnabled() &&
      topicConfig.model &&
      topicConfig.provider
    ) {
      const titleIdempotencyKey = conversationGenerationRequestKey(
        'topic-title',
        operationId,
        topicId,
      );
      const titleLaneKey = laneScopedClearKey(requestedContainerId, topicId, null);
      set(
        (state) =>
          trackDurableEnqueue(state, titleLaneKey, {
            idempotencyKey: titleIdempotencyKey,
            kind: 'topic_title',
          }),
        false,
        n('summaryTopicTitle/trackDurableEnqueue'),
      );
      let operation: Awaited<ReturnType<typeof tryEnqueueConversationGeneration>>;
      try {
        operation = await tryEnqueueConversationGeneration({
          config: {
            locale: globalHelpers.getCurrentLanguage(),
            model: topicConfig.model,
            provider: topicConfig.provider,
            title: { force: true, topicId },
          },
          kind: 'topic_title',
          idempotencyKey: titleIdempotencyKey,
          replaceActive: true,
          sessionId: requestedContainerId,
          topicId,
        });
      } finally {
        set(
          (state) => untrackDurableEnqueue(state, titleLaneKey, titleIdempotencyKey),
          false,
          n('summaryTopicTitle/untrackDurableEnqueue'),
        );
      }
      if (!isCurrentTopicRequest()) {
        finishOwnedOperation(false);
        return;
      }
      if (operation) {
        get().attachConversationGeneration({
          clearGeneration: resolveConversationClearGeneration(
            get(),
            requestedContainerId,
            topicId,
            null,
            'topic_title',
          ),
          generation: get().conversationNavigationGeneration,
          kind: operation.kind,
          lane: operation.lane,
          laneGeneration: operation.laneGeneration,
          operationId: operation.id,
          revision: operation.revision,
          sessionId: requestedContainerId,
          threadId: operation.threadId || undefined,
          topicId,
          userScope: requestedScope,
        });
        finishOwnedOperation(false);
        return;
      }
    }

    // Automatically summarize the topic title
    try {
      await chatService.fetchPresetTaskResult({
        abortController,
        onError: () => {
          if (!isCurrentTopicRequest()) return;

          didResolveTitle = true;
          updateOwnedTitle(originalTitle);
        },
        onFinish: async (text) => {
          if (!isCurrentTopicRequest()) return;

          updateOwnedTitle(text);
          await enqueueTitleSummaryPersistence(`${requestedScope}:topic:${topicId}`, async () => {
            if (!isCurrentTopicRequest()) return;

            await topicService.updateTopic(topicId, { title: text });
          });
          if (isCurrentTopicRequest()) didResolveTitle = true;
        },
        onMessageHandle: (chunk) => {
          if (!isCurrentTopicRequest()) return;

          switch (chunk.type) {
            case 'text': {
              output += chunk.text;
            }
          }

          updateOwnedTitle(output);
        },
        params: merge(topicConfig, chainSummaryTitle(messages, globalHelpers.getCurrentLanguage())),
        trace: get().getCurrentTracePayload({ traceName: TraceNameMap.SummaryTopicTitle, topicId }),
      });
    } finally {
      finishOwnedOperation(!didResolveTitle);
    }
  },
  favoriteTopic: async (id, favorite) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    await get().internal_updateTopic(id, { favorite });
  },

  updateTopicTitle: async (id, title) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedContainerId = get().activeId;
    if (!accountMutationSnapshot || !requestedContainerId) return;
    const operationId = `topic-title-update-${nanoid(8)}`;
    const loadingOperationKey = getTopicLoadingOperationKey(
      accountMutationSnapshot.scope,
      accountMutationSnapshot.ownershipInvalidationGeneration,
      requestedGeneration,
      get().conversationNavigationGeneration,
      requestedContainerId,
      id,
    );
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedContainerId;

    const lastActivityAt = Date.now();
    get().internal_dispatchTopic({
      id,
      touchActivity: true,
      type: 'updateTopic',
      value: { lastActivityAt, title },
    });
    acquireTopicLoadingOperation(loadingOperationKey, operationId);
    get().internal_updateTopicLoading(id, true);
    try {
      await topicService.updateTopic(id, { title }, { touchActivity: true });
      if (!isCurrentRequest()) return;

      await get().refreshTopic();
    } finally {
      releaseTopicLoadingOperation(loadingOperationKey, operationId);
      if (!hasCurrentTopicLoadingOperation(get(), id)) {
        get().internal_updateTopicLoading(id, false);
      }
    }
  },

  autoRenameTopicTitle: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const { activeId: sessionId, summaryTopicTitle, internal_updateTopicLoading } = get();
    if (!accountMutationSnapshot || !sessionId) return;
    const operationId = `topic-auto-rename-${nanoid(8)}`;
    const loadingOperationKey = getTopicLoadingOperationKey(
      accountMutationSnapshot.scope,
      accountMutationSnapshot.ownershipInvalidationGeneration,
      requestedGeneration,
      get().conversationNavigationGeneration,
      sessionId,
      id,
    );
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === sessionId;

    acquireTopicLoadingOperation(loadingOperationKey, operationId);
    internal_updateTopicLoading(id, true);
    try {
      const messages = await messageService.getMessages(sessionId, id);
      if (!isCurrentRequest()) return;

      await summaryTopicTitle(id, messages);
    } finally {
      releaseTopicLoadingOperation(loadingOperationKey, operationId);
      if (!hasCurrentTopicLoadingOperation(get(), id)) {
        internal_updateTopicLoading(id, false);
      }
    }
  },

  // query
  useFetchTopics: (enable, containerId) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<ChatTopic[]>(
      enable && requestedScope ? [SWR_USE_FETCH_TOPIC, requestedScope, containerId] : null,
      async (cacheKey: [string, string, string | undefined]) => {
        const containerId = cacheKey[2];
        const topics = await topicService.getTopics({ containerId });
        return topics.map(normalizeTopic);
      },
      {
        onSuccess: (topics) => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;
          if (!containerId) return;

          const nextMap = { ...get().topicMaps, [containerId]: topics };

          // no need to update map if the topics have been init and the map is the same
          if (get().topicsInit && isEqual(nextMap, get().topicMaps)) return;

          set(
            { topicMaps: nextMap, topicsInit: true },
            false,
            n('useFetchTopics(success)', { containerId }),
          );
        },
      },
    );
  },
  useSearchTopics: (keywords, sessionId, groupId) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<ChatTopic[]>(
      requestedScope ? [SWR_USE_SEARCH_TOPIC, requestedScope, keywords, sessionId, groupId] : null,
      (cacheKey: [string, string, string, string | undefined, string | undefined]) => {
        const keywords = cacheKey[2];
        const sessionId = cacheKey[3];
        const groupId = cacheKey[4];

        return topicService
          .searchTopics(keywords, sessionId, groupId)
          .then((topics) => topics.map(normalizeTopic));
      },
      {
        onSuccess: (data) => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

          set(
            { searchTopics: data, isSearchingTopic: false },
            false,
            n('useSearchTopics(success)', { keywords }),
          );
        },
      },
    );
  },

  switchTopic: async (id, skipRefreshMessage) => {
    const nextTopicId = id ?? null;
    if ((get().activeTopicId ?? null) === nextTopicId) return;
    if (!skipRefreshMessage) get().internal_invalidateConversation();

    set(
      { activeTopicId: !id ? (null as any) : id, activeThreadId: undefined },
      false,
      n('toggleTopic'),
    );

    // Reset supervisor todos when switching topics in group chats
    try {
      const { activeId, activeSessionType, internal_cancelSupervisorDecision } = get();
      // Determine group session robustly (cached flag or from session store)
      let isGroupSession = activeSessionType === 'group';
      if (activeSessionType === undefined) {
        const sessionStore = useSessionStore.getState();
        isGroupSession = sessionSelectors.isCurrentSessionGroupSession(sessionStore);
      }

      if (isGroupSession) {
        const newKey = messageMapKey(activeId, id ?? null);
        set(
          produce((state: ChatStoreState) => {
            state.supervisorTodos[newKey] = [];
          }),
          false,
          n('resetSupervisorTodosOnTopicSwitch', { groupId: activeId, topicId: id ?? null }),
        );

        // Also cancel any pending supervisor decisions tied to this group
        internal_cancelSupervisorDecision?.(activeId);
      }
    } catch {
      // no-op: resetting todos should not block topic switching
    }

    if (skipRefreshMessage) return;
    await get().refreshMessages();
  },
  // delete
  removeSessionTopics: async () => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const { switchTopic, activeId, refreshTopic } = get();
    if (!accountMutationSnapshot || !activeId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === activeId;

    await topicService.removeTopics(activeId);
    if (!isCurrentRequest()) return;

    await refreshTopic();
    if (!isCurrentRequest()) return;

    // switch to default topic
    switchTopic();
  },

  removeGroupTopics: async (groupId: string) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedContainerId = get().activeId;
    if (!accountMutationSnapshot || !requestedContainerId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedContainerId;
    const { switchTopic, refreshTopic } = get();

    // Get topics for this specific group from the topic map
    const groupTopics = get().topicMaps[groupId] || [];
    const topicIds = groupTopics.map((t) => t.id);

    if (topicIds.length > 0) {
      await topicService.batchRemoveTopics(topicIds);
      if (!isCurrentRequest()) return;
    }

    await refreshTopic();
    if (!isCurrentRequest()) return;

    // switch to default topic
    switchTopic();
  },
  removeAllTopics: async () => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedContainerId = get().activeId;
    if (!accountMutationSnapshot || !requestedContainerId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedContainerId;
    const { refreshTopic } = get();

    await topicService.removeAllTopic();
    if (isCurrentRequest()) await refreshTopic();
  },
  removeTopic: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedContainerId = get().activeId;
    const requestedActiveTopicId = get().activeTopicId;
    const requestedTopicId = id;
    const { mainSendMessageOperations, switchTopic } = get();
    if (!accountMutationSnapshot || !requestedContainerId || !requestedTopicId) return;
    const isPersistenceCurrent = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot);
    const isUiContinuationCurrent = () =>
      isPersistenceCurrent() &&
      get().activeId === requestedContainerId &&
      get().activeTopicId === requestedActiveTopicId;

    set(
      (state) => ({
        ...bumpTopicScopedClearGeneration(state, requestedContainerId, requestedTopicId),
        ...markConversationTopicDurableGenerationStopped(
          state,
          requestedContainerId,
          requestedTopicId,
        ),
      }),
      false,
      n('removeTopic/bumpTopicScopedClearGeneration'),
    );

    await get().cancelActiveDurableOpsInScope({
      allThreads: true,
      sessionId: requestedContainerId,
      topicId: requestedTopicId,
    });

    if (requestedActiveTopicId === requestedTopicId) {
      const operationKey = messageMapKey(requestedContainerId, requestedTopicId);
      const sendOperation = mainSendMessageOperations[operationKey];
      if (sendOperation?.abortController) {
        sendOperation.abortController.abort(MESSAGE_CANCEL_FLAT);
      }
    }

    // remove messages in the topic
    // TODO: Need to remove because server service don't need to call it
    await messageService.removeMessagesByAssistant(requestedContainerId, requestedTopicId);
    if (!isPersistenceCurrent()) return;

    // remove topic
    await topicService.removeTopic(requestedTopicId);
    if (!isPersistenceCurrent()) return;

    await get().refreshTopic({ accountMutationSnapshot, containerId: requestedContainerId });
    if (!isUiContinuationCurrent()) return;

    // switch bach to default topic
    if (requestedActiveTopicId === requestedTopicId) {
      switchTopic();
    }
  },
  removeUnstarredTopic: async () => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedContainerId = get().activeId;
    if (!accountMutationSnapshot || !requestedContainerId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedContainerId;
    const { refreshTopic, switchTopic } = get();
    const topics = topicSelectors.currentUnFavTopics(get());

    await topicService.batchRemoveTopics(topics.map((t) => t.id));
    if (!isCurrentRequest()) return;

    await refreshTopic();
    if (!isCurrentRequest()) return;

    // 切换到默认 topic
    switchTopic();
  },

  // Internal process method of the topics
  internal_updateTopicTitleInSummary: (id, title) => {
    get().internal_dispatchTopic(
      { type: 'updateTopic', id, value: { title } },
      'updateTopicTitleInSummary',
    );
  },
  refreshTopic: async (context) => {
    const accountMutationSnapshot =
      context?.accountMutationSnapshot ?? captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;
    const containerId = context?.containerId ?? get().activeId;
    if (!containerId) return;
    if (!isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot)) return;

    await mutateAccountSWR([SWR_USE_FETCH_TOPIC, accountMutationSnapshot.scope, containerId]);
    if (!isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot)) return;
  },

  internal_updateTopicLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) {
          if (state.topicLoadingIds.includes(id)) return state;

          return { topicLoadingIds: [...state.topicLoadingIds, id] };
        }
        if (!state.topicLoadingIds.includes(id)) return state;

        return { topicLoadingIds: state.topicLoadingIds.filter((i) => i !== id) };
      },
      false,
      n('updateTopicLoading'),
    );
  },

  internal_updateTopic: async (id, data) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedContainerId = get().activeId;
    if (!accountMutationSnapshot || !requestedContainerId) return;
    const operationId = `topic-update-${nanoid(8)}`;
    const loadingOperationKey = getTopicLoadingOperationKey(
      accountMutationSnapshot.scope,
      accountMutationSnapshot.ownershipInvalidationGeneration,
      requestedGeneration,
      get().conversationNavigationGeneration,
      requestedContainerId,
      id,
    );
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedContainerId;

    get().internal_dispatchTopic({ type: 'updateTopic', id, value: data });

    acquireTopicLoadingOperation(loadingOperationKey, operationId);
    get().internal_updateTopicLoading(id, true);
    try {
      await topicService.updateTopic(id, data);
      if (!isCurrentRequest()) return;

      await get().refreshTopic();
    } finally {
      releaseTopicLoadingOperation(loadingOperationKey, operationId);
      if (!hasCurrentTopicLoadingOperation(get(), id)) {
        get().internal_updateTopicLoading(id, false);
      }
    }
  },
  internal_createTopic: async (params, expectedConversationVersion) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedContainerId = get().activeId;
    if (!accountMutationSnapshot || !requestedContainerId) return;
    const operationId = `topic-create-${nanoid(8)}`;
    const loadingOperationKey = getTopicLoadingOperationKey(
      accountMutationSnapshot.scope,
      accountMutationSnapshot.ownershipInvalidationGeneration,
      requestedGeneration,
      get().conversationNavigationGeneration,
      requestedContainerId,
      operationId,
    );
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedContainerId;

    const tmpId = `topic-temp-${nanoid(8)}`;
    get().internal_dispatchTopic(
      { type: 'addTopic', value: { ...params, id: tmpId } },
      'internal_createTopic',
    );

    acquireTopicLoadingOperation(loadingOperationKey, operationId);
    get().internal_updateTopicLoading(tmpId, true);
    try {
      const topicId = await topicService.createTopic(
        params,
        expectedConversationVersion === undefined ? undefined : { expectedConversationVersion },
      );
      if (!isCurrentRequest()) return;

      await get().refreshTopic();
      if (!isCurrentRequest()) return;

      return topicId;
    } finally {
      releaseTopicLoadingOperation(loadingOperationKey, operationId);
      set(
        (state) => {
          const topics = state.topicMaps[requestedContainerId];
          const hasTemporaryTopic = topics?.some((topic) => topic.id === tmpId) ?? false;
          const hasTemporaryLoading = state.topicLoadingIds.includes(tmpId);
          if (!hasTemporaryTopic && !hasTemporaryLoading) return state;

          return {
            topicLoadingIds: hasTemporaryLoading
              ? state.topicLoadingIds.filter((topicId) => topicId !== tmpId)
              : state.topicLoadingIds,
            topicMaps: hasTemporaryTopic
              ? {
                  ...state.topicMaps,
                  [requestedContainerId]: topics!.filter((topic) => topic.id !== tmpId),
                }
              : state.topicMaps,
          };
        },
        false,
        n('internal_createTopic/cleanup', { operationId, requestedContainerId, tmpId }),
      );
    }
  },

  internal_dispatchTopic: (payload, action) => {
    const nextTopics = topicReducer(topicSelectors.currentTopics(get()), payload);
    const nextMap = { ...get().topicMaps, [get().activeId]: nextTopics };

    // no need to update map if is the same
    if (isEqual(nextMap, get().topicMaps)) return;

    set({ topicMaps: nextMap }, false, action ?? n(`dispatchTopic/${payload.type}`));
  },
});
