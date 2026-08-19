/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import { type ChatHubRPCDiagnosticOperation, MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import {
  ChatErrorType,
  ChatImageItem,
  ChatMessageError,
  ChatMessagePluginError,
  CreateMessageParams,
  GroundingSearch,
  MessageMetadata,
  MessageToolCall,
  ModelReasoning,
  TraceEventPayloads,
  TraceEventType,
  UIChatMessage,
  type UpdateMessageParams,
  UpdateMessageRAGParams,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { copyToClipboard } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { SWRResponse, mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { findRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { messageService } from '@/services/message';
import { rpcDiagnosticsService } from '@/services/rpcDiagnostics';
import { topicService } from '@/services/topic';
import { traceService } from '@/services/trace';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { ChatStore } from '@/store/chat/store';
import type { ConversationContext } from '@/store/chat/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { sleep } from '@/utils/sleep';
import { Action, setNamespace } from '@/utils/storeDebug';

import type { ChatStoreState } from '../../initialState';
import { chatSelectors } from '../../selectors';
import { preventLeavingFn, toggleBooleanList } from '../../utils';

const hasProtectedLoadingWork = (
  state: Pick<
    ChatStore,
    | 'chatLoadingIds'
    | 'messageInToolsCallingIds'
    | 'pluginApiLoadingIds'
    | 'reasoningLoadingIds'
    | 'searchWorkflowLoadingIds'
  >,
) =>
  state.chatLoadingIds.length > 0 ||
  state.messageInToolsCallingIds.length > 0 ||
  state.pluginApiLoadingIds.length > 0 ||
  state.reasoningLoadingIds.length > 0 ||
  state.searchWorkflowLoadingIds.length > 0;
import { MessageDispatch, messagesReducer } from './reducer';

const n = setNamespace('m');

const SWR_USE_FETCH_MESSAGES = 'SWR_USE_FETCH_MESSAGES';

// assistant-finalization persistence: the server diagnostics schema accepts
// attempts 1..3, and a short pause between tries lets transient gateway
// failures clear instead of burning both retries in the same instant
const FINALIZE_MAX_ATTEMPTS = 3;
const FINALIZE_RETRY_BACKOFF_MS = 400;
const conversationCacheKeys = new Set([
  SWR_USE_FETCH_MESSAGES,
  'SWR_USE_FETCH_TOPIC',
  'SWR_USE_FETCH_THREADS',
]);

const isConversationCacheKey = (key: unknown): boolean => {
  if (!Array.isArray(key)) return false;

  return conversationCacheKeys.has(key[0] as string);
};

const clearTitleSummaryOperations = (
  state: ChatStoreState,
): Pick<
  ChatStoreState,
  | 'threadLoadingIds'
  | 'threadMaps'
  | 'threadTitleSummaryOperations'
  | 'topicLoadingIds'
  | 'topicMaps'
  | 'topicTitleSummaryOperations'
> => {
  let topicMaps = state.topicMaps;
  let threadMaps = state.threadMaps;

  for (const [topicId, operation] of Object.entries(state.topicTitleSummaryOperations)) {
    const topics = topicMaps[operation.containerId];
    const topic = topics?.find((item) => item.id === topicId);
    if (!topic || topic.title !== operation.displayedTitle) continue;

    if (topicMaps === state.topicMaps) topicMaps = { ...state.topicMaps };
    topicMaps[operation.containerId] = topics.map((item) =>
      item.id === topicId ? { ...item, title: operation.originalTitle } : item,
    );
  }

  for (const [threadId, operation] of Object.entries(state.threadTitleSummaryOperations)) {
    const threads = threadMaps[operation.containerId];
    const thread = threads?.find((item) => item.id === threadId);
    if (!thread || thread.title !== operation.displayedTitle) continue;

    if (threadMaps === state.threadMaps) threadMaps = { ...state.threadMaps };
    threadMaps[operation.containerId] = threads.map((item) =>
      item.id === threadId ? { ...item, title: operation.originalTitle } : item,
    );
  }

  return {
    threadLoadingIds: state.threadLoadingIds.filter(
      (threadId) => !state.threadTitleSummaryOperations[threadId],
    ),
    threadMaps,
    threadTitleSummaryOperations: {},
    topicLoadingIds: state.topicLoadingIds.filter(
      (topicId) => !state.topicTitleSummaryOperations[topicId],
    ),
    topicMaps,
    topicTitleSummaryOperations: {},
  };
};

export interface ChatMessageAction {
  // create
  addAIMessage: () => Promise<void>;
  addUserMessage: (params: {
    expectedConversationVersion?: number;
    fileList?: string[];
    message: string;
  }) => Promise<void>;
  // delete
  /**
   * clear message on the active session
   */
  clearMessage: () => Promise<void>;
  clearAllTopicsHistory: () => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  deleteToolMessage: (id: string) => Promise<void>;
  // update
  updateInputMessage: (message: string) => void;
  modifyMessageContent: (id: string, content: string) => Promise<void>;
  toggleMessageEditing: (id: string, editing: boolean) => void;
  // query
  useFetchMessages: (
    enable: boolean,
    messageContextId: string,
    activeTopicId?: string,
    type?: 'session' | 'group',
  ) => SWRResponse<UIChatMessage[]>;
  copyMessage: (id: string, content: string) => Promise<void>;
  refreshMessages: (context?: ConversationContext) => Promise<void>;
  replaceMessages: (messages: UIChatMessage[]) => void;
  // =========  ↓ Internal Method ↓  ========== //
  // ========================================== //
  // ========================================== //
  internal_updateMessageRAG: (id: string, input: UpdateMessageRAGParams) => Promise<void>;

  /**
   * update message at the frontend
   * this method will not update messages to database
   */
  internal_dispatchMessage: (
    payload: MessageDispatch,
    context?: { topicId?: string | null; sessionId: string },
  ) => void;

  /**
   * update the message content with optimistic update
   * a method used by other action
   */
  internal_updateMessageContent: (
    id: string,
    content: string,
    extra?: {
      diagnosticId?: string;
      diagnosticOperation?: ChatHubRPCDiagnosticOperation;
      toolCalls?: MessageToolCall[];
      reasoning?: ModelReasoning;
      search?: GroundingSearch;
      metadata?: MessageMetadata;
      imageList?: ChatImageItem[];
      model?: string;
      observationId?: string;
      persistenceRecovery?: 'assistant_finalization';
      provider?: string;
      showNotification?: boolean;
      skipRefresh?: boolean;
      traceId?: string;
      conversationContext?: ConversationContext;
    },
  ) => Promise<{
    failure?: { bodyKind: string; httpStatus?: number };
    persistenceAmbiguous: boolean;
  }>;
  /**
   * update the message error with optimistic update
   */
  internal_updateMessageError: (id: string, error: ChatMessageError | null) => Promise<void>;
  internal_updateMessagePluginError: (
    id: string,
    error: ChatMessagePluginError | null,
  ) => Promise<void>;
  /**
   * create a message with optimistic update
   */
  internal_createMessage: (
    params: CreateMessageParams,
    context?: {
      expectedConversationVersion?: number;
      conversationContext?: ConversationContext;
      skipRefresh?: boolean;
      tempMessageId?: string;
    },
  ) => Promise<string | undefined>;
  /**
   * create a temp message for optimistic update
   * otherwise the message will be too slow to show
   */
  internal_createTmpMessage: (params: CreateMessageParams) => string;
  /**
   * delete the message content with optimistic update
   */
  internal_deleteMessage: (id: string) => Promise<void>;

  internal_fetchMessages: () => Promise<void>;
  internal_traceMessage: (id: string, payload: TraceEventPayloads) => Promise<void>;

  /**
   * method to toggle message create loading state
   * the AI message status is creating -> generating
   * other message role like user and tool , only this method need to be called
   */
  internal_toggleMessageLoading: (loading: boolean, id: string) => void;

  /**
   * helper to toggle the loading state of the array,used by these three toggleXXXLoading
   */
  internal_toggleLoadingArrays: (
    key: keyof ChatStoreState,
    loading: boolean,
    id?: string,
    action?: Action,
  ) => AbortController | undefined;

  /**
   * Update active session type
   */
  internal_updateActiveSessionType: (sessionType?: 'agent' | 'group') => void;
  /** Invalidates local producers and detaches durable work owned by the current conversation. */
  internal_invalidateConversation: () => void;
  /**
   * Update active session ID with cleanup of pending operations
   */
  internal_updateActiveId: (activeId: string) => void;
}

export const chatMessage: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatMessageAction
> = (set, get) => ({
  deleteMessage: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    if (!accountMutationSnapshot || !requestedSessionId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId;
    const message = chatSelectors.getMessageById(id)(get());
    if (!message) return;

    let ids = [message.id];

    // if the message is a tool calls, then delete all the related messages
    if (message.tools) {
      const toolMessageIds = message.tools.flatMap((tool) => {
        const messages = chatSelectors
          .activeBaseChats(get())
          .filter((m) => m.tool_call_id === tool.id);

        return messages.map((m) => m.id);
      });
      ids = ids.concat(toolMessageIds);
    }

    await get().cancelAndDetachDurableOps({
      assistantMessageIds: ids,
      sessionId: requestedSessionId,
      threadId: message.threadId,
      topicId: requestedTopicId,
    });
    await get().internal_invalidateMemoryCompaction(ids).catch(console.error);
    get().internal_dispatchMessage({ type: 'deleteMessages', ids });
    await messageService.removeMessages(ids);
    if (isCurrentRequest()) await get().refreshMessages();
  },

  deleteToolMessage: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const message = chatSelectors.getMessageById(id)(get());
    if (!message || message.role !== 'tool') return;

    const removeToolInAssistantMessage = async () => {
      if (!message.parentId) return;
      await get().internal_removeToolToAssistantMessage(message.parentId, message.tool_call_id);
    };

    await Promise.all([
      // 1. remove tool message
      get().internal_deleteMessage(id),
      // 2. remove the tool item in the assistant tools
      removeToolInAssistantMessage(),
    ]);
  },

  clearMessage: async () => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const {
      activeId,
      activeTopicId,
      refreshMessages,
      refreshTopic,
      switchTopic,
      activeSessionType,
    } = get();
    if (!accountMutationSnapshot || !activeId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === activeId &&
      get().activeTopicId === activeTopicId;

    await get().cancelAndDetachDurableOps({
      allThreads: true,
      sessionId: activeId,
      topicId: activeTopicId,
    });

    // Check if this is a group session - use activeSessionType if available, otherwise check session store
    let isGroupSession = activeSessionType === 'group';
    if (activeSessionType === undefined) {
      // Fallback: check session store directly
      const sessionStore = useSessionStore.getState();
      isGroupSession = sessionSelectors.isCurrentSessionGroupSession(sessionStore);
    }

    // For group sessions, we need to clear group messages using groupId
    // For regular sessions, we clear session messages using sessionId
    if (isGroupSession) {
      // For group chat, activeId is the groupId
      await messageService.removeMessagesByGroup(activeId, activeTopicId);
    } else {
      // For regular session, activeId is the sessionId
      await messageService.removeMessagesByAssistant(activeId, activeTopicId);
    }
    if (!isCurrentRequest()) return;

    if (activeTopicId) {
      await topicService.removeTopic(activeTopicId);
      if (!isCurrentRequest()) return;
    }
    await refreshTopic();
    if (!isCurrentRequest()) return;

    await refreshMessages();
    if (!isCurrentRequest()) return;

    // after remove topic , go back to default topic
    switchTopic();
  },
  clearAllTopicsHistory: async () => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    await get().cancelAndDetachDurableOps({ allConversations: true, allThreads: true });

    const {
      chatLoadingIdsAbortController,
      internal_cancelAllSupervisorDecisions,
      mainSendMessageOperations,
      messageInToolsCallingIdsAbortController,
      pluginApiAbortControllers,
      reasoningLoadingIdsAbortController,
      searchWorkflowLoadingIdsAbortController,
      threadTitleSummaryOperations,
      topicTitleSummaryOperations,
    } = get();

    set(
      (state) => ({ conversationClearGeneration: state.conversationClearGeneration + 1 }),
      false,
      n('clearAllTopicsHistory/start'),
    );

    chatLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
    messageInToolsCallingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
    reasoningLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
    searchWorkflowLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);

    for (const abortController of Object.values(pluginApiAbortControllers)) {
      abortController.abort(MESSAGE_CANCEL_FLAT);
    }

    for (const [operationKey, operation] of Object.entries(mainSendMessageOperations)) {
      if (operation.isLoading) {
        operation.abortController?.abort(MESSAGE_CANCEL_FLAT);
      }
      get().internal_toggleSendMessageOperation(operationKey, false);
    }

    for (const operation of Object.values(topicTitleSummaryOperations)) {
      operation.abortController.abort(MESSAGE_CANCEL_FLAT);
    }
    for (const operation of Object.values(threadTitleSummaryOperations)) {
      operation.abortController.abort(MESSAGE_CANCEL_FLAT);
    }

    internal_cancelAllSupervisorDecisions();
    get().internal_toggleChatLoading(
      false,
      undefined,
      n('clearAllTopicsHistory/cancelChatLoading'),
    );
    get().internal_toggleMessageInToolsCalling(
      false,
      undefined,
      n('clearAllTopicsHistory/cancelTools'),
    );
    get().internal_togglePluginApiCalling(
      false,
      undefined,
      n('clearAllTopicsHistory/cancelPlugin'),
    );
    get().internal_toggleChatReasoning(
      false,
      undefined,
      n('clearAllTopicsHistory/cancelReasoning'),
    );
    get().internal_toggleSearchWorkflow(false);
    useToolStore.setState({ builtinToolLoading: {} });

    set(
      (state) => ({
        ...clearTitleSummaryOperations(state),
        activePageContentUrl: undefined,
        activeThreadId: undefined,
        activeTopicId: null as any,
        chatLoadingIds: [],
        chatLoadingIdsAbortController: undefined,
        codeInterpreterExecuting: {},
        codeInterpreterImageMap: {},
        conversationClearGeneration: get().conversationClearGeneration,
        creatingThreadId: undefined,
        creatingTopic: false,
        creatingTopicId: undefined,
        dalleImageLoading: {},
        dalleImageMap: {},
        inSearchingMode: false,
        isCreatingMessage: false,
        isCreatingThread: false,
        isCreatingThreadMessage: false,
        isSearchingTopic: false,
        messageEditingIds: [],
        messageLoadingIds: [],
        messageInToolsCallingIds: [],
        messageInToolsCallingIdsAbortController: undefined,
        messageRAGLoadingIds: [],
        messageRetryingIds: [],
        messagesInit: false,
        messagesMap: {},
        mainSendMessageOperations: {},
        knowledgeBaseContextTokens: {},
        localFileLoading: {},
        pluginApiAbortControllers: {},
        pluginApiLoadingIds: [],
        portalMessageDetail: undefined,
        portalThreadId: undefined,
        portalToolMessage: undefined,
        reasoningLoadingIds: [],
        reasoningLoadingIdsAbortController: undefined,
        searchTopics: [],
        searchLoading: {},
        searchWorkflowLoadingIds: [],
        searchWorkflowLoadingIdsAbortController: undefined,
        serverGenerationOperations: {},
        topicLoadingIds: [],
        topicMaps: {},
        topicSearchKeywords: '',
        topicTitleSummaryOperations: {},
        showPortal: false,
        startToForkThread: undefined,
        supervisorTodos: {},
        supervisorDebounceTimers: {},
        supervisorDecisionAbortControllers: {},
        supervisorDecisionLoading: [],
        threadStartMessageId: undefined,
        threadMessageSendingId: undefined,
        toolCallingStreamIds: {},
        threadLoadingIds: [],
        threadMaps: {},
        threadInputMessage: '',
        threadTitleSummaryOperations: {},
        threadsInit: false,
        topicsInit: false,
      }),
      false,
      n('clearAllTopicsHistory'),
    );

    const requestedGeneration = get().conversationClearGeneration;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration;

    await messageService.removeAllTopicsHistory();
    if (!isCurrentRequest()) return;

    await mutate(isConversationCacheKey, undefined, { revalidate: false });
    if (isCurrentRequest()) await Promise.all([get().refreshMessages(), get().refreshTopic()]);
  },
  addAIMessage: async () => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const { internal_createMessage, updateInputMessage, activeTopicId, activeId, inputMessage } =
      get();
    if (!accountMutationSnapshot || !activeId) return;
    const requestedGeneration = get().conversationClearGeneration;
    const isCurrentConversation = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === activeId &&
      get().activeTopicId === activeTopicId;

    await internal_createMessage({
      content: inputMessage,
      role: 'assistant',
      sessionId: activeId,
      // if there is activeTopicId，then add topicId to message
      topicId: activeTopicId,
    });

    if (isCurrentConversation()) updateInputMessage('');
  },
  addUserMessage: async ({ message, fileList, expectedConversationVersion }) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const { internal_createMessage, updateInputMessage, activeTopicId, activeId, activeThreadId } =
      get();
    if (!accountMutationSnapshot || !activeId) return;
    const requestedGeneration = get().conversationClearGeneration;
    const isCurrentConversation = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === activeId &&
      get().activeTopicId === activeTopicId &&
      get().activeThreadId === activeThreadId;

    const newMessage: CreateMessageParams = {
      content: message,
      files: fileList,
      role: 'user',
      sessionId: activeId,
      // if there is activeTopicId，then add topicId to message
      topicId: activeTopicId,
      threadId: activeThreadId,
    };

    if (expectedConversationVersion === undefined) {
      await internal_createMessage(newMessage);
    } else {
      await internal_createMessage(newMessage, { expectedConversationVersion });
    }

    if (isCurrentConversation()) updateInputMessage('');
  },
  copyMessage: async (id, content) => {
    await copyToClipboard(content);

    get().internal_traceMessage(id, { eventType: TraceEventType.CopyMessage });
  },
  toggleMessageEditing: (id, editing) => {
    set(
      { messageEditingIds: toggleBooleanList(get().messageEditingIds, id, editing) },
      false,
      'toggleMessageEditing',
    );
  },

  updateInputMessage: (message) => {
    if (isEqual(message, get().inputMessage)) return;

    set({ inputMessage: message }, false, n('updateInputMessage', message));
  },
  modifyMessageContent: async (id, content) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    // tracing the diff of update
    // due to message content will change, so we need send trace before update,or will get wrong data
    get().internal_traceMessage(id, {
      eventType: TraceEventType.ModifyMessage,
      nextContent: content,
    });

    await get().internal_invalidateMemoryCompaction([id]).catch(console.error);
    await get().internal_updateMessageContent(id, content);
  },

  /**
   * @param enable - whether to enable the fetch
   * @param messageContextId - Can be sessionId or groupId
   */
  useFetchMessages: (enable, messageContextId, activeTopicId, type = 'session') => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<UIChatMessage[]>(
      enable && requestedScope
        ? [SWR_USE_FETCH_MESSAGES, requestedScope, messageContextId, activeTopicId, type]
        : null,
      async (cacheKey: [string, string, string, string | undefined, string]) => {
        const sessionId = cacheKey[2];
        const topicId = cacheKey[3];
        const requestType = cacheKey[4];

        return requestType === 'session'
          ? messageService.getMessages(sessionId, topicId)
          : messageService.getGroupMessages(sessionId, topicId);
      },
      {
        onSuccess: (messages, key) => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

          const nextMap = {
            ...get().messagesMap,
            [messageMapKey(messageContextId || '', activeTopicId)]: messages,
          };

          // no need to update map if the messages have been init and the map is the same
          if (get().messagesInit && isEqual(nextMap, get().messagesMap)) return;

          set(
            { messagesInit: true, messagesMap: nextMap },
            false,
            n('useFetchMessages', { messages, queryKey: key }),
          );
        },
      },
    );
  },
  // TODO: The mutate should only be called once, but since we haven't merge session and group,
  // we need to call it twice
  refreshMessages: async (context) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;
    const requestedGeneration = get().conversationClearGeneration;
    const sessionId = context?.sessionId ?? get().activeId;
    const topicId = context?.topicId ?? get().activeTopicId;
    const isCurrentRefresh = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration;

    await mutateAccountSWR([
      SWR_USE_FETCH_MESSAGES,
      accountMutationSnapshot.scope,
      sessionId,
      topicId,
      'session',
    ]);
    if (!isCurrentRefresh()) return;

    await mutateAccountSWR([
      SWR_USE_FETCH_MESSAGES,
      accountMutationSnapshot.scope,
      sessionId,
      topicId,
      'group',
    ]);
  },
  replaceMessages: (messages) => {
    set(
      {
        messagesMap: {
          ...get().messagesMap,
          [messageMapKey(get().activeId, get().activeTopicId)]: messages,
        },
      },
      false,
      'replaceMessages',
    );
  },

  internal_updateMessageRAG: async (id, data) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    if (!accountMutationSnapshot || !requestedSessionId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId;
    const { refreshMessages } = get();

    await messageService.updateMessageRAG(id, data);
    if (isCurrentRequest()) await refreshMessages();
  },

  // the internal process method of the AI message
  internal_dispatchMessage: (payload, context) => {
    const activeId = typeof context !== 'undefined' ? context.sessionId : get().activeId;
    const topicId = typeof context !== 'undefined' ? context.topicId : get().activeTopicId;

    const messagesKey = messageMapKey(activeId, topicId);

    const messages = messagesReducer(chatSelectors.getBaseChatsByKey(messagesKey)(get()), payload);

    const nextMap = { ...get().messagesMap, [messagesKey]: messages };

    if (isEqual(nextMap, get().messagesMap)) return;

    set({ messagesMap: nextMap }, false, { type: `dispatchMessage/${payload.type}`, payload });
  },

  internal_updateMessageError: async (id, error) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    if (!accountMutationSnapshot || !requestedSessionId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId;

    get().internal_dispatchMessage({ id, type: 'updateMessage', value: { error } });
    await messageService.updateMessage(id, { error });
    if (isCurrentRequest()) await get().refreshMessages();
  },

  internal_updateMessagePluginError: async (id, error) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    if (!accountMutationSnapshot || !requestedSessionId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId;

    await messageService.updateMessagePluginError(id, error);
    if (isCurrentRequest()) await get().refreshMessages();
  },

  internal_updateMessageContent: async (id, content, extra) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return { persistenceAmbiguous: false };

    const { internal_dispatchMessage, refreshMessages, internal_transformToolCalls } = get();
    const conversationContext = extra?.conversationContext;
    const dispatchContext = conversationContext
      ? { sessionId: conversationContext.sessionId, topicId: conversationContext.topicId }
      : undefined;
    const requestedClearGeneration =
      conversationContext?.clearGeneration ?? get().conversationClearGeneration;
    const requestedSessionId = conversationContext?.sessionId ?? get().activeId;
    const requestedTopicId = conversationContext?.topicId ?? get().activeTopicId;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedClearGeneration &&
      (conversationContext
        ? true
        : get().activeId === requestedSessionId && get().activeTopicId === requestedTopicId);
    if (!isCurrentRequest()) return { persistenceAmbiguous: false };

    const tools = extra?.toolCalls ? internal_transformToolCalls(extra.toolCalls) : undefined;
    const update: UpdateMessageParams = {
      content,
      ...(extra?.imageList && { imageList: extra.imageList }),
      ...(extra?.metadata && { metadata: extra.metadata }),
      ...(extra?.model && { model: extra.model }),
      ...(extra?.observationId && { observationId: extra.observationId }),
      ...(extra?.provider && { provider: extra.provider }),
      ...(extra?.reasoning && { reasoning: extra.reasoning }),
      ...(extra?.search && { search: extra.search }),
      ...(tools && { tools }),
      ...(extra?.traceId && { traceId: extra.traceId }),
    };

    // Due to the async update method and refresh need about 100ms
    // we need to update the message content at the frontend to avoid the update flick
    // refs: https://medium.com/@kyledeguzmanx/what-are-optimistic-updates-483662c3e171
    internal_dispatchMessage({ id, type: 'updateMessage', value: update }, dispatchContext);

    if (extra?.persistenceRecovery === 'assistant_finalization') {
      const diagnosticId = extra.diagnosticId || `td_${nanoid(20)}`;

      // The write may have been applied while only the RESPONSE was lost or
      // mangled (gateway/proxy interception) — read the message straight from
      // the server (NOT the store: the optimistic dispatch above already wrote
      // `update` into the in-memory map, and for a background conversation a
      // refresh won't overwrite it) and check whether this update actually
      // landed. The read MUST be scoped by id only: a conversation-list query
      // silently misses group messages (its groupId filter defaults to NULL)
      // and anything past its 1,000-row oldest-first page.
      const verifyFinalizationLanded = async (): Promise<boolean> => {
        try {
          // suppress the global 401-login / fetch-error UI (the dedicated
          // persistence warning is the single user-facing failure path) and
          // keep the read on the isolated diagnostic link
          const persisted = await messageService.getMessageById(id, {
            diagnosticId,
            diagnosticOperation: 'finalize_assistant_message',
            showNotification: false,
          });
          if (!persisted) return false;
          const persistedToolIds = new Set((persisted.tools ?? []).map((tool) => tool.id));
          const toolsLanded = (update.tools ?? []).every((tool) => persistedToolIds.has(tool.id));
          return persisted.content === content && toolsLanded;
        } catch {
          return false;
        }
      };

      for (let attempt = 1; attempt <= FINALIZE_MAX_ATTEMPTS; attempt += 1) {
        if (!isCurrentRequest()) return { persistenceAmbiguous: false };

        try {
          await messageService.updateMessage(id, update, {
            diagnosticId,
            diagnosticOperation: 'finalize_assistant_message',
            showNotification: false,
          });
          break;
        } catch (error) {
          const responseError = findRPCResponseError(error);
          if (!responseError) throw error;

          rpcDiagnosticsService.reportClientRPCFailure(responseError.details, {
            attempt,
            diagnosticId,
            operation: 'finalize_assistant_message',
            procedure: 'message.update',
            rpcEndpoint: 'lambda',
          });

          if (!isCurrentRequest()) return { persistenceAmbiguous: false };
          if (attempt < FINALIZE_MAX_ATTEMPTS) {
            // brief backoff — transient gateway hiccups usually clear
            await sleep(FINALIZE_RETRY_BACKOFF_MS);
            if (!isCurrentRequest()) return { persistenceAmbiguous: false };
            continue;
          }
          if (await verifyFinalizationLanded()) {
            if (!isCurrentRequest()) return { persistenceAmbiguous: false };
            if (!extra.skipRefresh) {
              try {
                await refreshMessages(conversationContext);
              } catch {
                // The confirmed write and optimistic payload remain authoritative.
              }
            }
            return { persistenceAmbiguous: false };
          }
          if (!isCurrentRequest()) return { persistenceAmbiguous: false };
          if (!extra.skipRefresh) {
            try {
              await refreshMessages(conversationContext);
            } catch {
              // The streamed content remains authoritative until a later refresh succeeds.
            }
          }
          if (!isCurrentRequest()) return { persistenceAmbiguous: false };
          internal_dispatchMessage({ id, type: 'updateMessage', value: update }, dispatchContext);
          return {
            failure: {
              bodyKind: responseError.details.bodyKind,
              httpStatus: responseError.details.httpStatus,
            },
            persistenceAmbiguous: true,
          };
        }
      }

      if (!extra.skipRefresh) {
        try {
          await refreshMessages(conversationContext);
        } catch {
          // The confirmed write and optimistic payload remain authoritative until revalidation recovers.
        }
      }
      return { persistenceAmbiguous: false };
    }

    if (extra?.diagnosticId || extra?.showNotification !== undefined) {
      await messageService.updateMessage(id, update, {
        diagnosticId: extra?.diagnosticId,
        diagnosticOperation: extra?.diagnosticOperation,
        showNotification: extra?.showNotification,
      });
    } else {
      await messageService.updateMessage(id, update);
    }
    if (isCurrentRequest() && !extra?.skipRefresh) await refreshMessages(conversationContext);
    return { persistenceAmbiguous: false };
  },

  internal_createMessage: async (message, context) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const {
      internal_createTmpMessage,
      refreshMessages,
      internal_toggleMessageLoading,
      internal_dispatchMessage,
    } = get();
    const conversationContext = context?.conversationContext;
    const conversationClearGeneration =
      conversationContext?.clearGeneration ?? get().conversationClearGeneration;
    const dispatchContext = conversationContext
      ? { sessionId: conversationContext.sessionId, topicId: conversationContext.topicId }
      : { sessionId: message.sessionId, topicId: message.topicId };
    const requestedSessionId = conversationContext?.sessionId ?? get().activeId;
    const requestedTopicId = conversationContext?.topicId ?? get().activeTopicId;
    const isCurrentAccount = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot);
    const isCurrentConversation = () =>
      isCurrentAccount() &&
      get().conversationClearGeneration === conversationClearGeneration &&
      (conversationContext
        ? true
        : get().activeId === requestedSessionId && get().activeTopicId === requestedTopicId);
    if (!isCurrentConversation()) return;

    let tempId = context?.tempMessageId;
    if (!tempId) {
      // use optimistic update to avoid the slow waiting
      tempId = internal_createTmpMessage(message);

      internal_toggleMessageLoading(true, tempId);
    }

    let id: string;
    try {
      id =
        context?.expectedConversationVersion === undefined
          ? await messageService.createMessage(message)
          : await messageService.createMessage(message, {
              expectedConversationVersion: context.expectedConversationVersion,
            });
    } catch (error) {
      if (!isCurrentConversation()) return;

      internal_toggleMessageLoading(false, tempId);
      internal_dispatchMessage(
        {
          id: tempId,
          type: 'updateMessage',
          value: {
            error: {
              body: error,
              message: (error as Error).message,
              type: ChatErrorType.CreateMessageError,
            },
          },
        },
        dispatchContext,
      );
      return;
    }

    if (!isCurrentAccount()) return;
    if (!isCurrentConversation()) {
      await messageService.removeMessage(id);
      return;
    }

    internal_dispatchMessage({ id: tempId, type: 'updateMessage', value: { id } }, dispatchContext);

    if (message.topicId) {
      get().internal_dispatchTopic({
        id: message.topicId,
        touchActivity: true,
        type: 'updateTopic',
        value: { lastActivityAt: Date.now() },
      });
      void get()
        .refreshTopic()
        .catch(() => undefined);
    }

    if (!context?.skipRefresh) {
      try {
        await refreshMessages(conversationContext);
      } catch {
        // Creation succeeded; retain the reconciled optimistic row until revalidation recovers.
      }
    }

    if (isCurrentConversation()) internal_toggleMessageLoading(false, tempId);
    return id;
  },

  internal_fetchMessages: async () => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    if (!accountMutationSnapshot || !requestedSessionId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId;

    const messages = await messageService.getMessages(requestedSessionId, requestedTopicId);
    if (!isCurrentRequest()) return;

    const nextMap = { ...get().messagesMap, [chatSelectors.currentChatKey(get())]: messages };
    // no need to update map if the messages have been init and the map is the same
    if (get().messagesInit && isEqual(nextMap, get().messagesMap)) return;

    set(
      { messagesInit: true, messagesMap: nextMap },
      false,
      n('internal_fetchMessages', { messages }),
    );
  },
  internal_createTmpMessage: (message) => {
    const { internal_dispatchMessage } = get();

    // use optimistic update to avoid the slow waiting
    const tempId = 'tmp_' + nanoid();
    internal_dispatchMessage({ type: 'createMessage', id: tempId, value: message });

    return tempId;
  },
  internal_deleteMessage: async (id: string) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    if (!accountMutationSnapshot || !requestedSessionId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId;

    await get().internal_invalidateMemoryCompaction([id]).catch(console.error);
    get().internal_dispatchMessage({ type: 'deleteMessage', id });
    await messageService.removeMessage(id);
    if (isCurrentRequest()) await get().refreshMessages();
  },
  internal_traceMessage: async (id, payload) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    // tracing the diff of update
    const message = chatSelectors.getMessageById(id)(get());
    if (!message) return;

    const traceId = message?.traceId;
    const observationId = message?.observationId;

    if (traceId && message?.role === 'assistant') {
      traceService
        .traceEvent({ traceId, observationId, content: message.content, ...payload })
        .catch();
    }
  },

  // ----- Loading ------- //
  internal_toggleMessageLoading: (loading, id) => {
    set(
      {
        messageLoadingIds: toggleBooleanList(get().messageLoadingIds, id, loading),
      },
      false,
      `internal_toggleMessageLoading/${loading ? 'start' : 'end'}`,
    );
  },
  internal_toggleLoadingArrays: (key, loading, id, action) => {
    const abortControllerKey = `${key}AbortController`;
    if (loading) {
      window.addEventListener('beforeunload', preventLeavingFn);

      const abortController = new AbortController();
      set(
        {
          [abortControllerKey]: abortController,
          [key]: toggleBooleanList(get()[key] as string[], id!, loading),
        },
        false,
        action,
      );

      return abortController;
    } else {
      if (!id) {
        set({ [abortControllerKey]: undefined, [key]: [] }, false, action);
      } else {
        const nextIds = toggleBooleanList(get()[key] as string[], id, loading);
        set(
          {
            [key]: nextIds,
            [abortControllerKey]: nextIds.length > 0 ? get()[abortControllerKey] : undefined,
          },
          false,
          action,
        );
      }

      const nextState = get();
      if (!hasProtectedLoadingWork(nextState)) {
        window.removeEventListener('beforeunload', preventLeavingFn);
      }
    }
  },
  internal_updateActiveSessionType: (sessionType?: 'agent' | 'group') => {
    if (get().activeSessionType === sessionType) return;

    set({ activeSessionType: sessionType }, false, n('updateActiveSessionType'));
  },

  internal_invalidateConversation: () => {
    const {
      chatLoadingIdsAbortController,
      mainSendMessageOperations,
      messageInToolsCallingIdsAbortController,
      pluginApiAbortControllers,
      reasoningLoadingIdsAbortController,
      searchWorkflowLoadingIdsAbortController,
      threadTitleSummaryOperations,
      topicTitleSummaryOperations,
    } = get();

    chatLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
    messageInToolsCallingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
    reasoningLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
    searchWorkflowLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);

    for (const abortController of Object.values(pluginApiAbortControllers)) {
      abortController.abort(MESSAGE_CANCEL_FLAT);
    }

    for (const operation of Object.values(mainSendMessageOperations)) {
      operation.abortController?.abort(MESSAGE_CANCEL_FLAT);
    }

    for (const operation of Object.values(topicTitleSummaryOperations)) {
      operation.abortController.abort(MESSAGE_CANCEL_FLAT);
    }
    for (const operation of Object.values(threadTitleSummaryOperations)) {
      operation.abortController.abort(MESSAGE_CANCEL_FLAT);
    }

    get().internal_cancelAllSupervisorDecisions();
    useToolStore.setState({ builtinToolLoading: {} });
    get().detachDurableOps({
      allThreads: true,
      sessionId: get().activeId,
      topicId: get().activeTopicId,
    });
    const invalidatedGenerationOperationKey = messageMapKey(get().activeId, get().activeTopicId);
    set(
      (state) => ({
        ...clearTitleSummaryOperations(state),
        chatLoadingIds: [],
        chatLoadingIdsAbortController: undefined,
        conversationNavigationGeneration: state.conversationNavigationGeneration + 1,
        creatingThreadId: undefined,
        isCreatingMessage: false,
        isCreatingThread: false,
        isCreatingThreadMessage: false,
        mainSendMessageOperations: {},
        messageLoadingIds: [],
        messageInToolsCallingIds: [],
        messageInToolsCallingIdsAbortController: undefined,
        // clear RAG loading too, or an id orphaned mid-retrieval leaves the
        // avatar spinner stuck across topic switches (clearMessage clears it)
        messageRAGLoadingIds: [],
        pluginApiAbortControllers: {},
        pluginApiLoadingIds: [],
        reasoningLoadingIds: [],
        reasoningLoadingIdsAbortController: undefined,
        searchWorkflowLoadingIds: [],
        searchWorkflowLoadingIdsAbortController: undefined,
        serverGenerationOperations: Object.fromEntries(
          Object.entries(state.serverGenerationOperations).filter(
            ([operationKey]) => operationKey !== invalidatedGenerationOperationKey,
          ),
        ),
        threadMessageSendingId: undefined,
        toolCallingStreamIds: {},
      }),
      false,
      n('invalidateConversation'),
    );
  },

  internal_updateActiveId: (activeId: string) => {
    const currentActiveId = get().activeId;
    if (currentActiveId === activeId) return;

    get().internal_invalidateConversation();
    set({ activeId }, false, n(`updateActiveId/${activeId}`));
  },
});
