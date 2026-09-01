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

import { preserveChatImageToolContentOnFetch } from '@/helpers/chatImageTaskId';
import { logDeferredGenerationLane } from '@/libs/logger/generationDebugClient';
import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { findRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { messageService } from '@/services/message';
import { rpcDiagnosticsService } from '@/services/rpcDiagnostics';
import { topicService } from '@/services/topic';
import { traceService } from '@/services/trace';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { ChatStore } from '@/store/chat/store';
import type { ConversationContext } from '@/store/chat/types';
import {
  abortAllChatLoadingLanes,
  abortChatLoadingLanesExceptMessageIds,
  clearChatLoadingLaneMaps,
  preserveChatLoadingLaneMapsForMessages,
} from '@/store/chat/utils/chatLoadingLanes';
import {
  isConversationClearFenceCurrent,
  markAllDurableGenerationsStopped,
  markConversationTopicDurableGenerationStopped,
  resolveConversationClearGeneration,
} from '@/store/chat/utils/conversationClearGeneration';
import {
  collectDeferredBrowserGenerationProtectedIds,
  deferredBrowserGenerationLaneKeysForTopic,
  findDeferredBrowserGenerationLaneByAssistantId,
  findDeferredBrowserGenerationLaneForConversation,
} from '@/store/chat/utils/deferredBrowserGeneration';
import { findMessageInMessagesMap, messageMapKey } from '@/store/chat/utils/messageMapKey';
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
import { MessageDispatch, messagesReducer } from './reducer';

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

const countPreservedAndAborted = (ids: string[], preserveMessageIds: Set<string>) => {
  const preservedCount = ids.filter((id) => preserveMessageIds.has(id)).length;
  return { abortedCount: ids.length - preservedCount, preservedCount };
};

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

type LoadingIdsArrayKey =
  | 'chatLoadingIds'
  | 'messageInToolsCallingIds'
  | 'reasoningLoadingIds'
  | 'searchWorkflowLoadingIds'
  | 'pluginApiLoadingIds';

const getLoadingAbortController = (
  state: ChatStoreState,
  key: LoadingIdsArrayKey,
): AbortController | undefined => {
  switch (key) {
    case 'chatLoadingIds': {
      return state.chatLoadingIdsAbortController;
    }
    case 'messageInToolsCallingIds': {
      return state.messageInToolsCallingIdsAbortController;
    }
    case 'reasoningLoadingIds': {
      return state.reasoningLoadingIdsAbortController;
    }
    case 'searchWorkflowLoadingIds': {
      return state.searchWorkflowLoadingIdsAbortController;
    }
    default: {
      return undefined;
    }
  }
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
    await get().internal_invalidateMemoryCompaction(ids, {
      rotateReportedInputTokenFloor: true,
    }).catch(console.error);
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
    const {
      activeId,
      activeTopicId,
      mainSendMessageOperations,
      refreshMessages,
      refreshTopic,
      switchTopic,
      activeSessionType,
    } = get();
    if (!accountMutationSnapshot || !activeId) return;
    const isUiContinuationCurrent = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().activeId === activeId &&
      get().activeTopicId === activeTopicId;

    set(
      (state) => ({
        // Destructive tombstone before the first await: fence attached operations
        // and registered in-flight enqueues for every thread of the cleared topic,
        // so a job that only becomes visible to the server after this snapshot is
        // still cancelled by sync instead of reviving.
        ...markConversationTopicDurableGenerationStopped(state, activeId, activeTopicId),
        conversationClearGeneration: state.conversationClearGeneration + 1,
      }),
      false,
      n('clearMessage/bumpClearGeneration'),
    );

    abortAllChatLoadingLanes(get());

    set(
      (state) => ({
        ...clearChatLoadingLaneMaps(),
        conversationClearGeneration: state.conversationClearGeneration,
      }),
      false,
      n('clearMessage/clearLoadingLanes'),
    );

    const operationKey = messageMapKey(activeId, activeTopicId);
    const sendOperation = mainSendMessageOperations[operationKey];
    if (sendOperation?.abortController) {
      sendOperation.abortController.abort(MESSAGE_CANCEL_FLAT);
    }

    await get().cancelActiveDurableOpsInScope({
      allThreads: true,
      sessionId: activeId,
      topicId: activeTopicId,
    });
    get().internal_abortDeferredBrowserLanesForTopic(activeId, activeTopicId, 'clear');

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
    if (!isUiContinuationCurrent()) return;

    if (activeTopicId) {
      await topicService.removeTopic(activeTopicId);
      if (!isUiContinuationCurrent()) return;
    }
    await refreshTopic();
    if (!isUiContinuationCurrent()) return;

    await refreshMessages();
    if (!isUiContinuationCurrent()) return;

    // after remove topic , go back to default topic
    switchTopic();
  },
  clearAllTopicsHistory: async () => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    // Global destructive tombstone before the first await: fence every attached
    // operation and registered in-flight enqueue so a job that only becomes
    // visible to the server after this snapshot is still cancelled by sync.
    set(
      (state) => ({
        ...markAllDurableGenerationsStopped(state),
        conversationClearGeneration: state.conversationClearGeneration + 1,
      }),
      false,
      n('clearAllTopicsHistory/start'),
    );

    await get().cancelActiveDurableOpsInScope({ allConversations: true, allThreads: true });

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

    abortAllChatLoadingLanes(get());

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
        ...clearChatLoadingLaneMaps(),
        ...clearTitleSummaryOperations(state),
        activePageContentUrl: undefined,
        activeThreadId: undefined,
        activeTopicId: null as any,
        codeInterpreterExecuting: {},
        codeInterpreterImageMap: {},
        conversationClearGeneration: get().conversationClearGeneration,
        creatingThreadId: undefined,
        creatingTopic: false,
        creatingTopicId: undefined,
        pendingTopicClientIds: {},
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

          const mapKey = messageMapKey(messageContextId || '', activeTopicId);
          const nextMap = {
            ...get().messagesMap,
            [mapKey]: preserveChatImageToolContentOnFetch(
              messages,
              get().messagesMap[mapKey] || [],
            ),
          };

          if (!(get().messagesInit && isEqual(nextMap, get().messagesMap))) {
            set(
              { messagesInit: true, messagesMap: nextMap },
              false,
              n('useFetchMessages', { messages, queryKey: key }),
            );
          }

          if (type !== 'group') {
            void get().internal_ensureReportedInputTokenFloorWatermark().catch(console.error);
          }
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
    const mapKey = messageMapKey(get().activeId, get().activeTopicId);
    set(
      {
        messagesMap: {
          ...get().messagesMap,
          [mapKey]: preserveChatImageToolContentOnFetch(messages, get().messagesMap[mapKey] || []),
        },
      },
      false,
      'replaceMessages',
    );
  },

  internal_updateMessageRAG: async (id, data) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const mapHit = findMessageInMessagesMap(get().messagesMap, id);
    const requestedClearGeneration = get().conversationClearGeneration;
    const isPersistenceCurrent = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedClearGeneration;
    if (!isPersistenceCurrent()) return;

    await messageService.updateMessageRAG(id, data);
    if (!isPersistenceCurrent()) return;

    await get().refreshMessages(
      mapHit
        ? {
            clearGeneration: requestedClearGeneration,
            generation: get().conversationNavigationGeneration,
            sessionId: mapHit.sessionId,
            topicId: mapHit.topicId,
          }
        : undefined,
    );
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
    const mapHit = findMessageInMessagesMap(get().messagesMap, id);
    const requestedSessionId = mapHit?.sessionId || get().activeId;
    const requestedTopicId = mapHit?.topicId ?? get().activeTopicId;
    if (!accountMutationSnapshot || !requestedSessionId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration;
    const dispatchContext =
      mapHit && mapHit.mapKey !== messageMapKey(get().activeId, get().activeTopicId)
        ? { sessionId: mapHit.sessionId, topicId: mapHit.topicId }
        : undefined;

    get().internal_dispatchMessage(
      { id, type: 'updateMessage', value: { error } },
      dispatchContext,
    );
    await messageService.updateMessage(id, { error });
    if (isCurrentRequest()) {
      await get().refreshMessages(
        dispatchContext
          ? {
              clearGeneration: requestedGeneration,
              generation: get().conversationNavigationGeneration,
              sessionId: requestedSessionId,
              topicId: requestedTopicId,
            }
          : undefined,
      );
    }
  },

  internal_updateMessagePluginError: async (id, error) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const mapHit = findMessageInMessagesMap(get().messagesMap, id);
    const requestedSessionId = mapHit?.sessionId || get().activeId;
    const requestedTopicId = mapHit?.topicId ?? get().activeTopicId;
    if (!accountMutationSnapshot || !requestedSessionId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration;
    const dispatchContext =
      mapHit && mapHit.mapKey !== messageMapKey(get().activeId, get().activeTopicId)
        ? { sessionId: mapHit.sessionId, topicId: mapHit.topicId }
        : undefined;

    await messageService.updateMessagePluginError(id, error);
    if (isCurrentRequest()) {
      await get().refreshMessages(
        dispatchContext
          ? {
              clearGeneration: requestedGeneration,
              generation: get().conversationNavigationGeneration,
              sessionId: requestedSessionId,
              topicId: requestedTopicId,
            }
          : undefined,
      );
    }
  },

  internal_updateMessageContent: async (id, content, extra) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const mapHit = findMessageInMessagesMap(get().messagesMap, id);
    const logPersistSkipped = (reason: 'hard_cancelled' | 'not_visible') => {
      try {
        const state = get();
        const sessionId =
          extra?.conversationContext?.sessionId ?? mapHit?.sessionId ?? state.activeId;
        const topicId =
          extra?.conversationContext?.topicId ?? mapHit?.topicId ?? state.activeTopicId;
        const assistantMessageId = mapHit?.message.parentId || id;
        const match =
          findDeferredBrowserGenerationLaneByAssistantId(
            state.deferredBrowserGenerationLanes,
            assistantMessageId,
          ) ??
          findDeferredBrowserGenerationLaneForConversation(
            state.deferredBrowserGenerationLanes,
            sessionId,
            topicId,
          );
        void logDeferredGenerationLane('message_persist_skipped', {
          assistantMessageId,
          reason,
          sessionId,
          spanId: match?.lane.spanId,
          topicId,
          visible: Boolean(
            mapHit && mapHit.mapKey === messageMapKey(state.activeId, state.activeTopicId),
          ),
        }).catch(() => undefined);
      } catch {
        // Diagnostics must never interrupt persistence.
      }
    };

    if (!accountMutationSnapshot) {
      logPersistSkipped('hard_cancelled');
      return { persistenceAmbiguous: false };
    }

    const { internal_dispatchMessage, refreshMessages, internal_transformToolCalls } = get();
    const activeMapKey = messageMapKey(get().activeId, get().activeTopicId);
    const inferredContext =
      mapHit && mapHit.mapKey !== activeMapKey && mapHit.sessionId
        ? {
            clearGeneration: resolveConversationClearGeneration(
              get(),
              mapHit.sessionId,
              mapHit.topicId,
              mapHit.message.threadId ?? null,
            ),
            generation: get().conversationNavigationGeneration,
            sessionId: mapHit.sessionId,
            threadId: mapHit.message.threadId ?? null,
            topicId: mapHit.topicId,
          }
        : undefined;
    const conversationContext = extra?.conversationContext ?? inferredContext;
    const dispatchContext = conversationContext
      ? { sessionId: conversationContext.sessionId, topicId: conversationContext.topicId }
      : undefined;
    const requestedClearGeneration =
      conversationContext?.clearGeneration ?? get().conversationClearGeneration;
    const requestedSessionId = conversationContext?.sessionId ?? get().activeId;
    const requestedTopicId = conversationContext?.topicId ?? get().activeTopicId;
    const isScopedFenceCurrent = () =>
      conversationContext?.sessionId
        ? isConversationClearFenceCurrent(
            get(),
            requestedClearGeneration,
            conversationContext.sessionId,
            conversationContext.topicId,
            conversationContext.threadId,
          )
        : get().conversationClearGeneration === requestedClearGeneration;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      isScopedFenceCurrent() &&
      (conversationContext
        ? true
        : get().activeId === requestedSessionId && get().activeTopicId === requestedTopicId);
    if (!isCurrentRequest()) {
      const hardCancelled =
        !isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) ||
        !isScopedFenceCurrent();
      logPersistSkipped(hardCancelled ? 'hard_cancelled' : 'not_visible');
      return { persistenceAmbiguous: false };
    }

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
    if (!(get().messagesInit && isEqual(nextMap, get().messagesMap))) {
      set(
        { messagesInit: true, messagesMap: nextMap },
        false,
        n('internal_fetchMessages', { messages }),
      );
    }

    void get().internal_ensureReportedInputTokenFloorWatermark().catch(console.error);
  },
  internal_createTmpMessage: (message) => {
    const { internal_dispatchMessage } = get();

    // use optimistic update to avoid the slow waiting
    const tempId = 'tmp_' + nanoid();
    internal_dispatchMessage(
      { type: 'createMessage', id: tempId, value: message },
      message.sessionId
        ? { sessionId: message.sessionId, topicId: message.topicId }
        : undefined,
    );

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

    await get().internal_invalidateMemoryCompaction([id], {
      rotateReportedInputTokenFloor: true,
    }).catch(console.error);
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
        const currentAbortController = getLoadingAbortController(get(), key as LoadingIdsArrayKey);
        set(
          {
            [key]: nextIds,
            [abortControllerKey]: nextIds.length > 0 ? currentAbortController : undefined,
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
      chatLoadingIds,
      chatLoadingIdsAbortController,
      deferredBrowserGenerationLanes,
      mainSendMessageOperations,
      messageInToolsCallingIdsAbortController,
      messageRAGLoadingIds,
      pluginApiAbortControllers,
      reasoningLoadingIdsAbortController,
      searchWorkflowLoadingIds,
      searchWorkflowLoadingIdsAbortController,
      threadTitleSummaryOperations,
      topicTitleSummaryOperations,
    } = get();
    const preserveMessageIds = collectDeferredBrowserGenerationProtectedIds(
      deferredBrowserGenerationLanes,
      get().messagesMap,
    );
    const pluginIds = Object.keys(pluginApiAbortControllers);
    const pluginCounts = countPreservedAndAborted(pluginIds, preserveMessageIds);
    const ragCounts = countPreservedAndAborted(messageRAGLoadingIds, preserveMessageIds);
    const searchCounts = countPreservedAndAborted(searchWorkflowLoadingIds, preserveMessageIds);
    const chatCounts = countPreservedAndAborted(chatLoadingIds, preserveMessageIds);
    const laneKeys = deferredBrowserGenerationLaneKeysForTopic(
      deferredBrowserGenerationLanes,
      get().activeId,
      get().activeTopicId,
    );
    const firstLane = laneKeys[0] ? deferredBrowserGenerationLanes[laneKeys[0]] : undefined;
    if (
      laneKeys.length > 0 ||
      pluginIds.length > 0 ||
      messageRAGLoadingIds.length > 0 ||
      searchWorkflowLoadingIds.length > 0 ||
      chatLoadingIds.length > 0
    ) {
      void logDeferredGenerationLane('invalidate_preserved', {
        abortedChatCount: chatCounts.abortedCount,
        abortedPluginCount: pluginCounts.abortedCount,
        abortedRagCount: ragCounts.abortedCount,
        abortedSearchCount: searchCounts.abortedCount,
        assistantMessageId:
          firstLane?.assistantMessageId ??
          chatLoadingIds[0] ??
          pluginIds[0] ??
          messageRAGLoadingIds[0] ??
          searchWorkflowLoadingIds[0] ??
          'none',
        deferredLaneCount: laneKeys.length,
        preservedChatCount: chatCounts.preservedCount,
        preservedPluginCount: pluginCounts.preservedCount,
        preservedRagCount: ragCounts.preservedCount,
        preservedSearchCount: searchCounts.preservedCount,
        sessionId: get().activeId,
        spanId: firstLane?.spanId,
        topicId: get().activeTopicId,
      }).catch(() => undefined);
    }

    abortChatLoadingLanesExceptMessageIds(get(), preserveMessageIds);

    if (preserveMessageIds.size === 0) {
      chatLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
      messageInToolsCallingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
      reasoningLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
      searchWorkflowLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
    } else {
      if (!get().messageInToolsCallingIds.some((messageId) => preserveMessageIds.has(messageId))) {
        messageInToolsCallingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
      }
      if (!get().reasoningLoadingIds.some((messageId) => preserveMessageIds.has(messageId))) {
        reasoningLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
      }
      if (!get().searchWorkflowLoadingIds.some((messageId) => preserveMessageIds.has(messageId))) {
        searchWorkflowLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
      }
    }

    for (const [messageId, abortController] of Object.entries(pluginApiAbortControllers)) {
      if (preserveMessageIds.has(messageId)) continue;
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
    if (preserveMessageIds.size === 0) {
      useToolStore.setState({ builtinToolLoading: {} });
    }
    const preservedLoading = preserveChatLoadingLaneMapsForMessages(get(), preserveMessageIds);
    const preservedPluginControllers = Object.fromEntries(
      Object.entries(get().pluginApiAbortControllers).filter(([messageId]) =>
        preserveMessageIds.has(messageId),
      ),
    );
    const preservedPluginLoadingIds = get().pluginApiLoadingIds.filter((messageId) =>
      preserveMessageIds.has(messageId),
    );
    const preservedToolsCallingIds = get().messageInToolsCallingIds.filter((messageId) =>
      preserveMessageIds.has(messageId),
    );
    const preservedReasoningIds = get().reasoningLoadingIds.filter((messageId) =>
      preserveMessageIds.has(messageId),
    );
    const preservedSearchIds = get().searchWorkflowLoadingIds.filter((messageId) =>
      preserveMessageIds.has(messageId),
    );
    const preservedRagIds = get().messageRAGLoadingIds.filter((messageId) =>
      preserveMessageIds.has(messageId),
    );
    const preservedToolCallingStreamIds = Object.fromEntries(
      Object.entries(get().toolCallingStreamIds).filter(([messageId]) =>
        preserveMessageIds.has(messageId),
      ),
    );
    get().detachDurableOps({
      allThreads: true,
      sessionId: get().activeId,
      topicId: get().activeTopicId,
    });
    const invalidatedGenerationOperationKey = messageMapKey(get().activeId, get().activeTopicId);
    set(
      (state) => ({
        ...(preserveMessageIds.size > 0 ? preservedLoading : clearChatLoadingLaneMaps()),
        ...clearTitleSummaryOperations(state),
        conversationNavigationGeneration: state.conversationNavigationGeneration + 1,
        creatingThreadId: undefined,
        isCreatingMessage: false,
        isCreatingThread: false,
        isCreatingThreadMessage: false,
        mainSendMessageOperations: {},
        messageLoadingIds: [],
        messageInToolsCallingIds: preservedToolsCallingIds,
        messageInToolsCallingIdsAbortController:
          preservedToolsCallingIds.length > 0
            ? state.messageInToolsCallingIdsAbortController
            : undefined,
        messageRAGLoadingIds: preservedRagIds,
        pluginApiAbortControllers: preservedPluginControllers,
        pluginApiLoadingIds: preservedPluginLoadingIds,
        reasoningLoadingIds: preservedReasoningIds,
        reasoningLoadingIdsAbortController:
          preservedReasoningIds.length > 0 ? state.reasoningLoadingIdsAbortController : undefined,
        searchWorkflowLoadingIds: preservedSearchIds,
        searchWorkflowLoadingIdsAbortController:
          preservedSearchIds.length > 0 ? state.searchWorkflowLoadingIdsAbortController : undefined,
        serverGenerationOperations: Object.fromEntries(
          Object.entries(state.serverGenerationOperations).filter(
            ([operationKey]) => operationKey !== invalidatedGenerationOperationKey,
          ),
        ),
        threadMessageSendingId: undefined,
        toolCallingStreamIds: preservedToolCallingStreamIds,
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
