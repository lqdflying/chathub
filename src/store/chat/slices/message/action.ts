/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
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
import { MESSAGE_CANCEL_FLAT, type ChatHubRPCDiagnosticOperation } from '@lobechat/const';
import { nanoid } from '@lobechat/utils';
import { copyToClipboard } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { SWRResponse, mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { findRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { messageService } from '@/services/message';
import { rpcDiagnosticsService } from '@/services/rpcDiagnostics';
import { topicService } from '@/services/topic';
import { traceService } from '@/services/trace';
import { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { useToolStore } from '@/store/tool';
import { Action, setNamespace } from '@/utils/storeDebug';

import type { ChatStoreState } from '../../initialState';
import { chatSelectors } from '../../selectors';
import { preventLeavingFn, toggleBooleanList } from '../../utils';
import { MessageDispatch, messagesReducer } from './reducer';

const n = setNamespace('m');

const SWR_USE_FETCH_MESSAGES = 'SWR_USE_FETCH_MESSAGES';
const conversationCacheKeys = new Set([
  SWR_USE_FETCH_MESSAGES,
  'SWR_USE_FETCH_TOPIC',
  'SWR_USE_FETCH_THREADS',
]);

const isConversationCacheKey = (key: unknown): boolean => {
  if (!Array.isArray(key)) return false;

  return conversationCacheKeys.has(key[0] as string);
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
  deleteMessage: (id: string) => Promise<void>;
  deleteToolMessage: (id: string) => Promise<void>;
  clearAllMessages: () => Promise<void>;
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
  refreshMessages: () => Promise<void>;
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
    },
  ) => Promise<{ persistenceAmbiguous: boolean }>;
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

    get().internal_dispatchMessage({ type: 'deleteMessages', ids });
    await messageService.removeMessages(ids);
    await get().refreshMessages();
  },

  deleteToolMessage: async (id) => {
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
    const {
      activeId,
      activeTopicId,
      refreshMessages,
      refreshTopic,
      switchTopic,
      activeSessionType,
    } = get();

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

    if (activeTopicId) {
      await topicService.removeTopic(activeTopicId);
    }
    await refreshTopic();
    await refreshMessages();

    // after remove topic , go back to default topic
    switchTopic();
  },
  clearAllMessages: async () => {
    const {
      chatLoadingIdsAbortController,
      internal_cancelAllSupervisorDecisions,
      mainSendMessageOperations,
      messageInToolsCallingIdsAbortController,
      pluginApiAbortControllers,
      reasoningLoadingIdsAbortController,
      searchWorkflowLoadingIdsAbortController,
    } = get();

    set(
      (state) => ({ conversationClearGeneration: state.conversationClearGeneration + 1 }),
      false,
      n('clearAllMessages/start'),
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

    internal_cancelAllSupervisorDecisions();
    get().internal_toggleChatLoading(false, undefined, n('clearAllMessages/cancelChatLoading'));
    get().internal_toggleMessageInToolsCalling(
      false,
      undefined,
      n('clearAllMessages/cancelTools'),
    );
    get().internal_togglePluginApiCalling(false, undefined, n('clearAllMessages/cancelPlugin'));
    get().internal_toggleChatReasoning(false, undefined, n('clearAllMessages/cancelReasoning'));
    get().internal_toggleSearchWorkflow(false);
    useToolStore.setState({ builtinToolLoading: {} });

    set(
      {
        activePageContentUrl: undefined,
        activeThreadId: undefined,
        activeTopicId: null as any,
        chatLoadingIds: [],
        chatLoadingIdsAbortController: undefined,
        codeInterpreterExecuting: {},
        codeInterpreterImageMap: {},
        conversationClearGeneration: get().conversationClearGeneration,
        creatingTopic: false,
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
        topicLoadingIds: [],
        topicMaps: {},
        topicSearchKeywords: '',
        showPortal: false,
        startToForkThread: undefined,
        supervisorTodos: {},
        supervisorDebounceTimers: {},
        supervisorDecisionAbortControllers: {},
        supervisorDecisionLoading: [],
        threadStartMessageId: undefined,
        toolCallingStreamIds: {},
        threadLoadingIds: [],
        threadMaps: {},
        threadInputMessage: '',
        threadsInit: false,
        topicsInit: false,
      },
      false,
      n('clearAllMessages'),
    );

    await messageService.removeAllTopicsHistory();

    await mutate(isConversationCacheKey, undefined, { revalidate: false });
    await Promise.all([get().refreshMessages(), get().refreshTopic()]);
  },
  addAIMessage: async () => {
    const { internal_createMessage, updateInputMessage, activeTopicId, activeId, inputMessage } =
      get();
    if (!activeId) return;

    await internal_createMessage({
      content: inputMessage,
      role: 'assistant',
      sessionId: activeId,
      // if there is activeTopicId，then add topicId to message
      topicId: activeTopicId,
    });

    updateInputMessage('');
  },
  addUserMessage: async ({ message, fileList, expectedConversationVersion }) => {
    const { internal_createMessage, updateInputMessage, activeTopicId, activeId, activeThreadId } =
      get();
    if (!activeId) return;

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

    updateInputMessage('');
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
    // tracing the diff of update
    // due to message content will change, so we need send trace before update,or will get wrong data
    get().internal_traceMessage(id, {
      eventType: TraceEventType.ModifyMessage,
      nextContent: content,
    });

    await get().internal_updateMessageContent(id, content);
  },

  /**
   * @param enable - whether to enable the fetch
   * @param messageContextId - Can be sessionId or groupId
   */
  useFetchMessages: (enable, messageContextId, activeTopicId, type = 'session') =>
    useClientDataSWR<UIChatMessage[]>(
      enable ? [SWR_USE_FETCH_MESSAGES, messageContextId, activeTopicId, type] : null,
      async ([, sessionId, topicId, type]: [string, string, string | undefined, string]) =>
        type === 'session'
          ? messageService.getMessages(sessionId, topicId)
          : messageService.getGroupMessages(sessionId, topicId),
      {
        onSuccess: (messages, key) => {
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
    ),
  // TODO: The mutate should only be called once, but since we haven't merge session and group,
  // we need to call it twice
  refreshMessages: async () => {
    await mutate([SWR_USE_FETCH_MESSAGES, get().activeId, get().activeTopicId, 'session']);
    await mutate([SWR_USE_FETCH_MESSAGES, get().activeId, get().activeTopicId, 'group']);
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
    const { refreshMessages } = get();

    await messageService.updateMessageRAG(id, data);
    await refreshMessages();
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
    get().internal_dispatchMessage({ id, type: 'updateMessage', value: { error } });
    await messageService.updateMessage(id, { error });
    await get().refreshMessages();
  },

  internal_updateMessagePluginError: async (id, error) => {
    await messageService.updateMessagePluginError(id, error);
    await get().refreshMessages();
  },

  internal_updateMessageContent: async (id, content, extra) => {
    const { internal_dispatchMessage, refreshMessages, internal_transformToolCalls } = get();

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
    internal_dispatchMessage({ id, type: 'updateMessage', value: update });

    if (extra?.persistenceRecovery === 'assistant_finalization') {
      const diagnosticId = extra.diagnosticId || `td_${nanoid(20)}`;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
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

          if (attempt < 2) continue;
          if (!extra.skipRefresh) {
            try {
              await refreshMessages();
            } catch {
              // The streamed content remains authoritative until a later refresh succeeds.
            }
          }
          internal_dispatchMessage({ id, type: 'updateMessage', value: update });
          return { persistenceAmbiguous: true };
        }
      }

      if (!extra.skipRefresh) {
        try {
          await refreshMessages();
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
    if (!extra?.skipRefresh) await refreshMessages();
    return { persistenceAmbiguous: false };
  },

  internal_createMessage: async (message, context) => {
    const {
      internal_createTmpMessage,
      refreshMessages,
      internal_toggleMessageLoading,
      internal_dispatchMessage,
    } = get();
    const conversationClearGeneration = get().conversationClearGeneration;
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
      if (get().conversationClearGeneration !== conversationClearGeneration) return;

      internal_toggleMessageLoading(false, tempId);
      internal_dispatchMessage({
        id: tempId,
        type: 'updateMessage',
        value: {
          error: {
            body: error,
            message: (error as Error).message,
            type: ChatErrorType.CreateMessageError,
          },
        },
      });
      return;
    }

    if (get().conversationClearGeneration !== conversationClearGeneration) {
      await messageService.removeMessage(id);
      return;
    }

    internal_dispatchMessage({ id: tempId, type: 'updateMessage', value: { id } });

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
        await refreshMessages();
      } catch {
        // Creation succeeded; retain the reconciled optimistic row until revalidation recovers.
      }
    }

    internal_toggleMessageLoading(false, tempId);
    return id;
  },

  internal_fetchMessages: async () => {
    const messages = await messageService.getMessages(get().activeId, get().activeTopicId);
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
    get().internal_dispatchMessage({ type: 'deleteMessage', id });
    await messageService.removeMessage(id);
    await get().refreshMessages();
  },
  internal_traceMessage: async (id, payload) => {
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
      } else
        set(
          {
            [abortControllerKey]: undefined,
            [key]: toggleBooleanList(get()[key] as string[], id, loading),
          },
          false,
          action,
        );

      window.removeEventListener('beforeunload', preventLeavingFn);
    }
  },
  internal_updateActiveSessionType: (sessionType?: 'agent' | 'group') => {
    if (get().activeSessionType === sessionType) return;

    set({ activeSessionType: sessionType }, false, n('updateActiveSessionType'));
  },

  internal_updateActiveId: (activeId: string) => {
    const currentActiveId = get().activeId;
    if (currentActiveId === activeId) return;

    // Before switching sessions, cancel all pending supervisor decisions
    get().internal_cancelAllSupervisorDecisions();

    set({ activeId }, false, n(`updateActiveId/${activeId}`));
  },
});
