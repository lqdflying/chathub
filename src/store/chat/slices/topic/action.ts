/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Note: To make the code more logic and readable, we just disable the auto sort key eslint rule
// DON'T REMOVE THE FIRST LINE
import { chainSummaryTitle } from '@lobechat/prompts';
import { TraceNameMap, UIChatMessage } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import { produce } from 'immer';
import useSWR, { SWRResponse, mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { message } from '@/components/AntdStaticMethods';
import { LOADING_FLAT } from '@/const/message';
import { useClientDataSWR } from '@/libs/swr';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { CreateTopicParams } from '@/services/topic/type';
import type { ChatStore } from '@/store/chat';
import type { ChatStoreState } from '@/store/chat/initialState';
import { enqueueTitleSummaryPersistence } from '@/store/chat/utils/titleSummaryOperation';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
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

export interface ChatTopicAction {
  favoriteTopic: (id: string, favState: boolean) => Promise<void>;
  openNewTopicOrSaveTopic: () => Promise<void>;
  refreshTopic: () => Promise<void>;
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
    const { switchTopic, saveToTopic, refreshMessages, activeTopicId } = get();
    const hasTopic = !!activeTopicId;

    if (hasTopic) switchTopic();
    else {
      await saveToTopic();
      refreshMessages();
    }
  },

  createTopic: async (sessionId, groupId, expectedConversationVersion) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const { activeId, activeSessionType, internal_createTopic } = get();
    if (!requestedScope || !activeId) return;
    const creatingTopicId = `topic-create-${nanoid(8)}`;
    const isCurrentRequest = () =>
      authSelectors.currentUserScope(useUserStore.getState()) === requestedScope &&
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
    // if there is no message, stop
    const messages = chatSelectors.activeBaseChats(get());
    if (messages.length === 0) return;

    const { activeId, activeSessionType, summaryTopicTitle, internal_createTopic } = get();

    // 1. create topic and bind these messages
    const topicId = await internal_createTopic({
      title: t('defaultTitle', { ns: 'topic' }),
      messages: messages.map((m) => m.id),
      ...(activeSessionType === 'group'
        ? { groupId: groupId || activeId }
        : { sessionId: sessionId || activeId }),
    });
    if (!topicId) return;

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
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedContainerId = get().activeId;
    if (!requestedScope || !requestedContainerId) return;
    const isCurrentRequest = () =>
      authSelectors.currentUserScope(useUserStore.getState()) === requestedScope &&
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
      message.destroy(loadingMessageKey);
    }
    if (!isCurrentRequest()) return;

    await get().refreshTopic();
    if (!isCurrentRequest()) return;

    message.success(t('duplicateSuccess', { ns: 'topic' }));

    await get().switchTopic(newTopicId);
  },
  // update
  summaryTopicTitle: async (topicId, messages) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedContainerId = get().activeId;
    if (!requestedScope || !requestedContainerId) return;

    const topic = get().topicMaps[requestedContainerId]?.find((item) => item.id === topicId);
    if (!topic) return;

    const previousOperation = get().topicTitleSummaryOperations[topicId];
    previousOperation?.abortController.abort();

    const operationId = `topic-summary-${nanoid(8)}`;
    const abortController = new AbortController();
    const originalTitle = previousOperation?.originalTitle ?? topic.title;
    const isCurrentTopicRequest = () =>
      authSelectors.currentUserScope(useUserStore.getState()) === requestedScope &&
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
      set(
        (state) => {
          const operation = state.topicTitleSummaryOperations[topicId];
          if (operation?.operationId !== operationId) return state;

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
            topicLoadingIds: state.topicLoadingIds.filter((id) => id !== topicId),
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
          await enqueueTitleSummaryPersistence(
            `${requestedScope}:topic:${topicId}`,
            async () => {
              if (!isCurrentTopicRequest()) return;

              await topicService.updateTopic(topicId, { title: text });
            },
          );
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
    await get().internal_updateTopic(id, { favorite });
  },

  updateTopicTitle: async (id, title) => {
    const lastActivityAt = Date.now();
    get().internal_dispatchTopic({
      id,
      touchActivity: true,
      type: 'updateTopic',
      value: { lastActivityAt, title },
    });
    get().internal_updateTopicLoading(id, true);
    await topicService.updateTopic(id, { title }, { touchActivity: true });
    await get().refreshTopic();
    get().internal_updateTopicLoading(id, false);
  },

  autoRenameTopicTitle: async (id) => {
    const { activeId: sessionId, summaryTopicTitle, internal_updateTopicLoading } = get();

    internal_updateTopicLoading(id, true);
    const messages = await messageService.getMessages(sessionId, id);

    await summaryTopicTitle(id, messages);
    internal_updateTopicLoading(id, false);
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

    return useSWR<ChatTopic[]>(
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
    const { switchTopic, activeId, refreshTopic } = get();

    await topicService.removeTopics(activeId);
    await refreshTopic();

    // switch to default topic
    switchTopic();
  },

  removeGroupTopics: async (groupId: string) => {
    const { switchTopic, refreshTopic } = get();

    // Get topics for this specific group from the topic map
    const groupTopics = get().topicMaps[groupId] || [];
    const topicIds = groupTopics.map((t) => t.id);

    if (topicIds.length > 0) {
      await topicService.batchRemoveTopics(topicIds);
    }

    await refreshTopic();

    // switch to default topic
    switchTopic();
  },
  removeAllTopics: async () => {
    const { refreshTopic } = get();

    await topicService.removeAllTopic();
    await refreshTopic();
  },
  removeTopic: async (id) => {
    const { activeId, activeTopicId, switchTopic, refreshTopic } = get();

    // remove messages in the topic
    // TODO: Need to remove because server service don't need to call it
    await messageService.removeMessagesByAssistant(activeId, id);

    // remove topic
    await topicService.removeTopic(id);
    await refreshTopic();

    // switch bach to default topic
    if (activeTopicId === id) switchTopic();
  },
  removeUnstarredTopic: async () => {
    const { refreshTopic, switchTopic } = get();
    const topics = topicSelectors.currentUnFavTopics(get());

    await topicService.batchRemoveTopics(topics.map((t) => t.id));
    await refreshTopic();

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
  refreshTopic: async () => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    if (!requestedScope) return;

    return mutate([SWR_USE_FETCH_TOPIC, requestedScope, get().activeId]);
  },

  internal_updateTopicLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) return { topicLoadingIds: [...state.topicLoadingIds, id] };

        return { topicLoadingIds: state.topicLoadingIds.filter((i) => i !== id) };
      },
      false,
      n('updateTopicLoading'),
    );
  },

  internal_updateTopic: async (id, data) => {
    get().internal_dispatchTopic({ type: 'updateTopic', id, value: data });

    get().internal_updateTopicLoading(id, true);
    await topicService.updateTopic(id, data);
    await get().refreshTopic();
    get().internal_updateTopicLoading(id, false);
  },
  internal_createTopic: async (params, expectedConversationVersion) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedContainerId = get().activeId;
    if (!requestedScope || !requestedContainerId) return;
    const isCurrentRequest = () =>
      authSelectors.currentUserScope(useUserStore.getState()) === requestedScope &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedContainerId;

    const tmpId = Date.now().toString();
    const clearTemporaryTopic = () => {
      set(
        (state) => ({
          topicLoadingIds: state.topicLoadingIds.filter((id) => id !== tmpId),
          topicMaps: {
            ...state.topicMaps,
            [requestedContainerId]: (state.topicMaps[requestedContainerId] || []).filter(
              (topic) => topic.id !== tmpId,
            ),
          },
        }),
        false,
        n('internal_createTopic/clearTemporaryTopic', { requestedContainerId, tmpId }),
      );
    };
    get().internal_dispatchTopic(
      { type: 'addTopic', value: { ...params, id: tmpId } },
      'internal_createTopic',
    );

    get().internal_updateTopicLoading(tmpId, true);
    const topicId = await topicService.createTopic(
      params,
      expectedConversationVersion === undefined ? undefined : { expectedConversationVersion },
    );
    if (!isCurrentRequest()) {
      clearTemporaryTopic();
      return;
    }

    get().internal_updateTopicLoading(tmpId, false);

    get().internal_updateTopicLoading(topicId, true);
    await get().refreshTopic();
    if (!isCurrentRequest()) {
      clearTemporaryTopic();
      get().internal_updateTopicLoading(topicId, false);
      return;
    }

    get().internal_updateTopicLoading(topicId, false);

    return topicId;
  },

  internal_dispatchTopic: (payload, action) => {
    const nextTopics = topicReducer(topicSelectors.currentTopics(get()), payload);
    const nextMap = { ...get().topicMaps, [get().activeId]: nextTopics };

    // no need to update map if is the same
    if (isEqual(nextMap, get().topicMaps)) return;

    set({ topicMaps: nextMap }, false, action ?? n(`dispatchTopic/${payload.type}`));
  },
});
