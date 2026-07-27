/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import { LOADING_FLAT, THREAD_DRAFT_ID, isDeprecatedEdition } from '@lobechat/const';
import { chainSummaryTitle } from '@lobechat/prompts';
import {
  CreateMessageParams,
  SendThreadMessageParams,
  ThreadItem,
  ThreadType,
  UIChatMessage,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import isEqual from 'fast-deep-equal';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { threadService } from '@/services/thread';
import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { threadSelectors } from '@/store/chat/selectors';
import { ChatStore } from '@/store/chat/store';
import { enqueueTitleSummaryPersistence } from '@/store/chat/utils/titleSummaryOperation';
import { globalHelpers } from '@/store/global/helpers';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';
import { authSelectors, systemAgentSelectors } from '@/store/user/selectors';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { ThreadDispatch, threadReducer } from './reducer';

const n = setNamespace('thd');
const SWR_USE_FETCH_THREADS = 'SWR_USE_FETCH_THREADS';

const threadLoadingOperations = new Map<string, Set<string>>();

const getThreadLoadingOperationKey = (
  scope: string,
  ownershipInvalidationGeneration: number,
  conversationGeneration: number,
  sessionId: string,
  topicId: string,
  threadId: string,
): string =>
  `${scope}:${ownershipInvalidationGeneration}:${conversationGeneration}:${sessionId}:${topicId}:${threadId}`;

const acquireThreadLoadingOperation = (loadingOperationKey: string, operationId: string): void => {
  const operations = threadLoadingOperations.get(loadingOperationKey) ?? new Set<string>();
  operations.add(operationId);
  threadLoadingOperations.set(loadingOperationKey, operations);
};

const releaseThreadLoadingOperation = (loadingOperationKey: string, operationId: string): void => {
  const operations = threadLoadingOperations.get(loadingOperationKey);
  if (!operations?.delete(operationId)) return;
  if (operations.size > 0) return;

  threadLoadingOperations.delete(loadingOperationKey);
};

const hasThreadLoadingOperation = (loadingOperationKey: string): boolean => {
  return (threadLoadingOperations.get(loadingOperationKey)?.size ?? 0) > 0;
};

const hasCurrentThreadLoadingOperation = (
  state: Pick<ChatStore, 'activeId' | 'activeTopicId' | 'conversationClearGeneration'>,
  threadId: string,
): boolean => {
  const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
  if (!accountMutationSnapshot || !state.activeId || !state.activeTopicId) return true;

  const loadingOperationKey = getThreadLoadingOperationKey(
    accountMutationSnapshot.scope,
    accountMutationSnapshot.ownershipInvalidationGeneration,
    state.conversationClearGeneration,
    state.activeId,
    state.activeTopicId,
    threadId,
  );

  return hasThreadLoadingOperation(loadingOperationKey);
};

export interface ChatThreadAction {
  // update
  updateThreadInputMessage: (message: string) => void;
  refreshThreads: () => Promise<void>;
  /**
   * Sends a new thread message to the AI chat system
   */
  sendThreadMessage: (params: SendThreadMessageParams) => Promise<void>;
  resendThreadMessage: (messageId: string) => Promise<void>;
  delAndResendThreadMessage: (messageId: string) => Promise<void>;
  createThread: (params: {
    expectedConversationVersion?: number;
    message: CreateMessageParams;
    sourceMessageId: string;
    topicId: string;
    type: ThreadType;
  }) => Promise<{ threadId: string; messageId: string }>;
  openThreadCreator: (messageId: string) => void;
  openThreadInPortal: (threadId: string, sourceMessageId: string) => void;
  closeThreadPortal: () => void;
  useFetchThreads: (enable: boolean, topicId?: string) => SWRResponse<ThreadItem[]>;
  summaryThreadTitle: (threadId: string, messages: UIChatMessage[]) => Promise<void>;
  updateThreadTitle: (id: string, title: string) => Promise<void>;
  removeThread: (id: string) => Promise<void>;
  switchThread: (id: string) => void;

  internal_updateThreadTitleInSummary: (id: string, title: string) => void;
  internal_updateThreadLoading: (id: string, loading: boolean) => void;
  internal_updateThread: (id: string, data: Partial<ThreadItem>) => Promise<void>;
  internal_dispatchThread: (payload: ThreadDispatch, action?: any) => void;
}

export const chatThreadMessage: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatThreadAction
> = (set, get) => ({
  updateThreadInputMessage: (message) => {
    if (isEqual(message, get().threadInputMessage)) return;

    set({ threadInputMessage: message }, false, n(`updateThreadInputMessage`, message));
  },

  openThreadCreator: (messageId) => {
    set(
      { threadStartMessageId: messageId, portalThreadId: undefined, startToForkThread: true },
      false,
      'openThreadCreator',
    );
    get().togglePortal(true);
  },
  openThreadInPortal: (threadId, sourceMessageId) => {
    set(
      { portalThreadId: threadId, threadStartMessageId: sourceMessageId, startToForkThread: false },
      false,
      'openThreadInPortal',
    );
    get().togglePortal(true);
  },

  closeThreadPortal: () => {
    set(
      { threadStartMessageId: undefined, portalThreadId: undefined, startToForkThread: undefined },
      false,
      'closeThreadPortal',
    );
    get().togglePortal(false);
  },
  sendThreadMessage: async ({ message }) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    if (!accountMutationSnapshot) return;

    const {
      internal_coreProcessMessage,
      activeTopicId,
      activeId,
      threadStartMessageId,
      newThreadMode,
      portalThreadId,
    } = get();
    if (!activeId || !activeTopicId) return;
    const requestedSessionId = activeId;
    const requestedTopicId = activeTopicId;
    let expectedPortalThreadId = portalThreadId;
    const requestedThreadStartMessageId = threadStartMessageId;
    const threadMessageSendingId = `thread-send-${nanoid(8)}`;
    let parentMessageId: string | undefined = undefined;
    let tempMessageId: string | undefined = undefined;
    const clearCurrentThreadMessageLoading = () => {
      if (get().threadMessageSendingId !== threadMessageSendingId) return;

      set(
        { isCreatingThreadMessage: false, threadMessageSendingId: undefined },
        false,
        n('creatingThreadMessage/stop'),
      );
      get().internal_toggleMessageLoading(false, tempMessageId);
    };
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId &&
      get().portalThreadId === expectedPortalThreadId &&
      get().threadStartMessageId === requestedThreadStartMessageId;

    // if message is empty or no files, then stop
    if (!message) return;
    if (!portalThreadId && !threadStartMessageId) return;

    const expectedConversationVersion = await messageService.getConversationVersion();
    if (!isCurrentRequest()) return;

    set(
      { isCreatingThreadMessage: true, threadMessageSendingId },
      false,
      n('creatingThreadMessage/start'),
    );

    const newMessage: CreateMessageParams = {
      content: message,
      // if message has attached with files, then add files to message and the agent
      // files: fileIdList,
      role: 'user',
      sessionId: activeId,
      // if there is activeTopicId，then add topicId to message
      topicId: activeTopicId,
      threadId: portalThreadId,
    };

    // if there is no portalThreadId, then create a thread and then append message
    if (!portalThreadId) {
      // we need to create a temp message for optimistic update
      tempMessageId = get().internal_createTmpMessage({
        ...newMessage,
        threadId: THREAD_DRAFT_ID,
      });
      get().internal_toggleMessageLoading(true, tempMessageId);

      const { threadId, messageId } = await get().createThread({
        expectedConversationVersion,
        message: newMessage,
        sourceMessageId: threadStartMessageId,
        topicId: activeTopicId,
        type: newThreadMode,
      });
      if (!threadId || !isCurrentRequest()) {
        clearCurrentThreadMessageLoading();
        return;
      }

      parentMessageId = messageId;

      // mark the portal in thread mode
      await get().refreshThreads();
      if (!isCurrentRequest()) {
        clearCurrentThreadMessageLoading();
        return;
      }

      await get().refreshMessages();
      if (!isCurrentRequest()) {
        clearCurrentThreadMessageLoading();
        return;
      }

      expectedPortalThreadId = threadId;
      get().openThreadInPortal(threadId, threadStartMessageId);
    } else {
      // if there is a thread, just append message
      // we need to create a temp message for optimistic update
      tempMessageId = get().internal_createTmpMessage(newMessage);
      get().internal_toggleMessageLoading(true, tempMessageId);

      parentMessageId = await get().internal_createMessage(newMessage, {
        expectedConversationVersion,
        tempMessageId,
      });
      if (!isCurrentRequest()) {
        clearCurrentThreadMessageLoading();
        return;
      }
    }

    if (!parentMessageId) {
      clearCurrentThreadMessageLoading();
      return;
    }
    //  update assistant update to make it rerank
    useSessionStore.getState().triggerSessionUpdate(requestedSessionId);

    // Get the current messages to generate AI response
    const activeThreadId = expectedPortalThreadId;
    if (!activeThreadId) {
      clearCurrentThreadMessageLoading();
      return;
    }
    const messages = threadSelectors.portalAIChats({
      ...get(),
      activeId: requestedSessionId,
      activeTopicId: requestedTopicId,
      portalThreadId: activeThreadId,
      threadStartMessageId: requestedThreadStartMessageId,
    });
    const contextExportCaptureId = get().consumeContextExportArm();

    try {
      await internal_coreProcessMessage(messages, parentMessageId, {
        contextExportCaptureId,
        expectedConversationVersion,
        ragQuery: get().internal_shouldUseRAG() ? message : undefined,
        threadId: activeThreadId,
        inPortalThread: true,
      });
    } finally {
      if (contextExportCaptureId && isCurrentRequest()) {
        get().completeContextExport(contextExportCaptureId);
      }
    }
    if (!isCurrentRequest()) {
      clearCurrentThreadMessageLoading();
      return;
    }

    clearCurrentThreadMessageLoading();

    // 说明是在新建 thread，需要自动总结标题
    if (!portalThreadId) {
      const portalThread = threadSelectors.currentPortalThread({
        ...get(),
        activeId: requestedSessionId,
        activeTopicId: requestedTopicId,
        portalThreadId: activeThreadId,
      });

      if (!portalThread) return;

      const chats = threadSelectors.portalAIChats({
        ...get(),
        activeId: requestedSessionId,
        activeTopicId: requestedTopicId,
        portalThreadId: activeThreadId,
        threadStartMessageId: requestedThreadStartMessageId,
      });
      await get().summaryThreadTitle(portalThread.id, chats);
    }
  },
  resendThreadMessage: async (messageId) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    const requestedPortalThreadId = get().portalThreadId;
    if (
      !accountMutationSnapshot ||
      !requestedSessionId ||
      !requestedTopicId ||
      !requestedPortalThreadId
    ) {
      return;
    }
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId &&
      get().portalThreadId === requestedPortalThreadId;
    const chats = threadSelectors.portalAIChats(get());
    if (!isCurrentRequest()) return;

    await get().internal_resendMessage(messageId, {
      messages: chats,
      threadId: requestedPortalThreadId,
      inPortalThread: true,
    });
  },
  delAndResendThreadMessage: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    await get().resendThreadMessage(id);
  },
  createThread: async ({
    expectedConversationVersion,
    message,
    sourceMessageId,
    topicId,
    type,
  }) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    if (!accountMutationSnapshot || !requestedSessionId || requestedTopicId !== topicId) {
      return { messageId: '', threadId: '' };
    }
    const creatingThreadId = `thread-create-${nanoid(8)}`;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId;

    set({ creatingThreadId, isCreatingThread: true }, false, n('creatingThread/start'));

    const createThreadPayload = {
      topicId,
      sourceMessageId,
      type,
      message,
    };
    try {
      const data =
        expectedConversationVersion === undefined
          ? await threadService.createThreadWithMessage(createThreadPayload)
          : await threadService.createThreadWithMessage(createThreadPayload, {
              expectedConversationVersion,
            });
      if (!isCurrentRequest()) {
        return { messageId: '', threadId: '' };
      }

      return data;
    } finally {
      if (isCurrentRequest() && get().creatingThreadId === creatingThreadId) {
        set(
          { creatingThreadId: undefined, isCreatingThread: false },
          false,
          n('creatingThread/end'),
        );
      }
    }
  },

  useFetchThreads: (enable, topicId) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<ThreadItem[]>(
      enable && !!topicId && !isDeprecatedEdition && requestedScope
        ? [SWR_USE_FETCH_THREADS, requestedScope, topicId]
        : null,
      async (cacheKey: [string, string, string]) => threadService.getThreads(cacheKey[2]),
      {
        onSuccess: (threads) => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

          const nextMap = { ...get().threadMaps, [topicId!]: threads };

          // no need to update map if the topics have been init and the map is the same
          if (get().topicsInit && isEqual(nextMap, get().topicMaps)) return;

          set(
            { threadMaps: nextMap, threadsInit: true },
            false,
            n('useFetchThreads(success)', { topicId }),
          );
        },
      },
    );
  },

  refreshThreads: async () => {
    const topicId = get().activeTopicId;
    if (!topicId) return;
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    return mutateAccountSWR([SWR_USE_FETCH_THREADS, accountMutationSnapshot.scope, topicId]);
  },
  removeThread: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    const requestedThreadId = get().activeThreadId;
    if (!accountMutationSnapshot || !requestedSessionId || !requestedTopicId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId &&
      get().activeThreadId === requestedThreadId;

    await threadService.removeThread(id);
    if (!isCurrentRequest()) return;

    await get().refreshThreads();
    if (!isCurrentRequest()) return;

    if (requestedThreadId === id) {
      set({ activeThreadId: undefined });
    }
  },
  switchThread: async (id) => {
    set({ activeThreadId: id }, false, n('toggleTopic'));
  },
  updateThreadTitle: async (id, title) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    await get().internal_updateThread(id, { title });
  },

  summaryThreadTitle: async (threadId, messages) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    const requestedPortalThreadId = get().portalThreadId;
    if (
      !accountMutationSnapshot ||
      !requestedSessionId ||
      !requestedTopicId ||
      requestedPortalThreadId !== threadId
    ) {
      return;
    }
    const requestedScope = accountMutationSnapshot.scope;

    const portalThread = get().threadMaps[requestedTopicId]?.find((item) => item.id === threadId);
    if (!portalThread) return;

    const previousOperation = get().threadTitleSummaryOperations[threadId];
    previousOperation?.abortController.abort();
    if (previousOperation) {
      releaseThreadLoadingOperation(
        previousOperation.loadingOperationKey,
        previousOperation.operationId,
      );
    }

    const operationId = `thread-summary-${nanoid(8)}`;
    const abortController = new AbortController();
    const originalTitle = previousOperation?.originalTitle ?? portalThread.title;
    const loadingOperationKey = getThreadLoadingOperationKey(
      accountMutationSnapshot.scope,
      accountMutationSnapshot.ownershipInvalidationGeneration,
      requestedGeneration,
      requestedSessionId,
      requestedTopicId,
      threadId,
    );
    const isCurrentThreadRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId &&
      get().portalThreadId === requestedPortalThreadId &&
      get().threadTitleSummaryOperations[threadId]?.operationId === operationId;
    const updateOwnedTitle = (title: string) => {
      set(
        (state) => {
          const operation = state.threadTitleSummaryOperations[threadId];
          if (operation?.operationId !== operationId) return state;

          const threads = state.threadMaps[requestedTopicId] || [];
          return {
            threadMaps: {
              ...state.threadMaps,
              [requestedTopicId]: threads.map((item) =>
                item.id === threadId ? { ...item, title } : item,
              ),
            },
            threadTitleSummaryOperations: {
              ...state.threadTitleSummaryOperations,
              [threadId]: { ...operation, displayedTitle: title },
            },
          };
        },
        false,
        n('summaryThreadTitle/update', { operationId, requestedTopicId, threadId }),
      );
    };
    const finishOwnedOperation = (restoreOriginalTitle: boolean) => {
      releaseThreadLoadingOperation(loadingOperationKey, operationId);
      const shouldClearLoading = !hasCurrentThreadLoadingOperation(get(), threadId);
      set(
        (state) => {
          const operation = state.threadTitleSummaryOperations[threadId];
          if (operation?.operationId !== operationId) {
            if (!shouldClearLoading || !state.threadLoadingIds.includes(threadId)) return state;

            return {
              threadLoadingIds: state.threadLoadingIds.filter((id) => id !== threadId),
            };
          }

          const nextOperations = { ...state.threadTitleSummaryOperations };
          delete nextOperations[threadId];

          const threads = state.threadMaps[requestedTopicId] || [];
          const nextThreads = restoreOriginalTitle
            ? threads.map((item) =>
                item.id === threadId && item.title === operation.displayedTitle
                  ? { ...item, title: operation.originalTitle }
                  : item,
              )
            : threads;

          return {
            threadLoadingIds: shouldClearLoading
              ? state.threadLoadingIds.filter((id) => id !== threadId)
              : state.threadLoadingIds,
            threadMaps:
              nextThreads === threads
                ? state.threadMaps
                : { ...state.threadMaps, [requestedTopicId]: nextThreads },
            threadTitleSummaryOperations: nextOperations,
          };
        },
        false,
        n('summaryThreadTitle/finish', { operationId, requestedTopicId, threadId }),
      );
    };

    acquireThreadLoadingOperation(loadingOperationKey, operationId);
    set(
      (state) => ({
        threadLoadingIds: state.threadLoadingIds.includes(threadId)
          ? state.threadLoadingIds
          : [...state.threadLoadingIds, threadId],
        threadMaps: {
          ...state.threadMaps,
          [requestedTopicId]: (state.threadMaps[requestedTopicId] || []).map((item) =>
            item.id === threadId ? { ...item, title: LOADING_FLAT } : item,
          ),
        },
        threadTitleSummaryOperations: {
          ...state.threadTitleSummaryOperations,
          [threadId]: {
            abortController,
            containerId: requestedTopicId,
            displayedTitle: LOADING_FLAT,
            loadingOperationKey,
            operationId,
            originalTitle,
          },
        },
      }),
      false,
      n('summaryThreadTitle/start', { operationId, requestedTopicId, threadId }),
    );

    let output = '';
    let didResolveTitle = false;
    const threadConfig = systemAgentSelectors.thread(useUserStore.getState());

    try {
      await chatService.fetchPresetTaskResult({
        abortController,
        onError: () => {
          if (!isCurrentThreadRequest()) return;

          didResolveTitle = true;
          updateOwnedTitle(originalTitle);
        },
        onFinish: async (text) => {
          if (!isCurrentThreadRequest()) return;

          updateOwnedTitle(text);
          await enqueueTitleSummaryPersistence(`${requestedScope}:thread:${threadId}`, async () => {
            if (!isCurrentThreadRequest()) return;

            await threadService.updateThread(threadId, { title: text });
          });
          if (isCurrentThreadRequest()) didResolveTitle = true;
        },
        onMessageHandle: (chunk) => {
          if (!isCurrentThreadRequest()) return;

          switch (chunk.type) {
            case 'text': {
              output += chunk.text;
            }
          }

          updateOwnedTitle(output);
        },
        params: merge(
          threadConfig,
          chainSummaryTitle(messages, globalHelpers.getCurrentLanguage()),
        ),
      });
    } finally {
      finishOwnedOperation(!didResolveTitle);
    }
  },

  // Internal process method of the topics
  internal_updateThreadTitleInSummary: (id, title) => {
    get().internal_dispatchThread(
      { type: 'updateThread', id, value: { title } },
      'updateThreadTitleInSummary',
    );
  },

  internal_updateThreadLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) {
          if (state.threadLoadingIds.includes(id)) return state;

          return { threadLoadingIds: [...state.threadLoadingIds, id] };
        }
        if (!state.threadLoadingIds.includes(id)) return state;

        return { threadLoadingIds: state.threadLoadingIds.filter((i) => i !== id) };
      },
      false,
      n('updateThreadLoading'),
    );
  },

  internal_updateThread: async (id, data) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    if (!accountMutationSnapshot || !requestedSessionId || !requestedTopicId) return;
    const operationId = `thread-update-${nanoid(8)}`;
    const loadingOperationKey = getThreadLoadingOperationKey(
      accountMutationSnapshot.scope,
      accountMutationSnapshot.ownershipInvalidationGeneration,
      requestedGeneration,
      requestedSessionId,
      requestedTopicId,
      id,
    );
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId;

    get().internal_dispatchThread({ type: 'updateThread', id, value: data });

    acquireThreadLoadingOperation(loadingOperationKey, operationId);
    get().internal_updateThreadLoading(id, true);
    try {
      await threadService.updateThread(id, data);
      if (!isCurrentRequest()) return;

      await get().refreshThreads();
    } finally {
      releaseThreadLoadingOperation(loadingOperationKey, operationId);
      if (!hasCurrentThreadLoadingOperation(get(), id)) {
        get().internal_updateThreadLoading(id, false);
      }
    }
  },

  internal_dispatchThread: (payload, action) => {
    const nextThreads = threadReducer(threadSelectors.currentTopicThreads(get()), payload);
    const nextMap = { ...get().threadMaps, [get().activeTopicId!]: nextThreads };

    // no need to update map if is the same
    if (isEqual(nextMap, get().threadMaps)) return;

    set({ threadMaps: nextMap }, false, action ?? n(`dispatchThread/${payload.type}`));
  },
});
