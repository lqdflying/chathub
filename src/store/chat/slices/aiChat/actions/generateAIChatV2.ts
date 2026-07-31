/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import { DEFAULT_AGENT_CHAT_CONFIG, INBOX_SESSION_ID, isDesktop } from '@lobechat/const';
import { knowledgeBaseQAPrompts } from '@lobechat/prompts';
import {
  ChatImageItem,
  ChatTopic,
  ChatVideoItem,
  MessageSemanticSearchChunk,
  SendMessageParams,
  SendMessageServerResponse,
  TraceNameMap,
  UIChatMessage,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { TRPCClientError } from '@trpc/client';
import { t } from 'i18next';
import { produce } from 'immer';
import { StateCreator } from 'zustand/vanilla';

import { isModelNativeSearchDisabledProvider } from '@/helpers/modelNativeSearch';
import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { getAgentStoreState } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/slices/chat';
import { aiModelSelectors, aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { MainSendMessageOperation } from '@/store/chat/slices/aiChat/initialState';
import type { ChatStore } from '@/store/chat/store';
import type { ConversationContext } from '@/store/chat/types';
import { getFileStoreState } from '@/store/file/store';
import { getSessionStoreState } from '@/store/session';
import { useUserStore } from '@/store/user';
import { WebBrowsingManifest } from '@/tools/web-browsing';
import { normalizeTopic } from '@/utils/client/topic';
import { setNamespace } from '@/utils/storeDebug';

import { chatSelectors, topicSelectors } from '../../../selectors';
import { messageMapKey } from '../../../utils/messageMapKey';

const n = setNamespace('ai');

type GuardedSendMessageParams = SendMessageParams & {
  contextExportCaptureId?: string;
  expectedConversationVersion?: number;
};

export interface AIGenerateV2Action {
  /**
   * Sends a new message to the AI chat system
   */
  sendMessageInServer: (params: GuardedSendMessageParams) => Promise<void>;
  /**
   * Cancels sendMessageInServer operation for a specific topic/session
   */
  cancelSendMessageInServer: (topicId?: string) => void;
  clearSendMessageError: () => void;
  internal_refreshAiChat: (params: {
    topics?: ChatTopic[];
    messages: UIChatMessage[];
    sessionId: string;
    topicId?: string;
  }) => void;
  /**
   * Executes the core processing logic for AI messages
   * including preprocessing and postprocessing steps
   */
  internal_execAgentRuntime: (params: {
    conversationContext?: ConversationContext;
    contextExportCaptureId?: string;
    expectedConversationVersion?: number;
    messages: UIChatMessage[];
    userMessageId: string;
    assistantMessageId: string;
    isWelcomeQuestion?: boolean;
    inSearchWorkflow?: boolean;
    /**
     * the RAG query content, should be embedding and used in the semantic search
     */
    ragQuery?: string;
    threadId?: string;
    inPortalThread?: boolean;
    traceId?: string;
  }) => Promise<void>;
  /**
   * Toggle sendMessageInServer operation state
   */
  internal_toggleSendMessageOperation: (
    key: string | { sessionId: string; topicId?: string | null },
    loading: boolean,
    cancelReason?: string,
  ) => AbortController | undefined;
  internal_updateSendMessageOperation: (
    key: string | { sessionId: string; topicId?: string | null },
    value: Partial<MainSendMessageOperation> | null,
    actionName?: any,
  ) => void;
}

export const generateAIChatV2: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  AIGenerateV2Action
> = (set, get) => ({
  sendMessageInServer: async ({
    contextExportCaptureId,
    expectedConversationVersion: capturedConversationVersion,
    files,
    isWelcomeQuestion,
    message,
    onlyAddUserMessage,
  }) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const { activeTopicId, activeId, activeThreadId, internal_execAgentRuntime, mainInputEditor } =
      get();
    if (!accountMutationSnapshot || !activeId) return;
    const requestedScope = accountMutationSnapshot.scope;
    let conversationContext: ConversationContext = {
      generation: get().conversationClearGeneration,
      sessionId: activeId,
      topicId: activeTopicId,
    };
    const isCurrentConversation = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === conversationContext.generation &&
      get().activeId === conversationContext.sessionId &&
      (get().activeTopicId ?? null) === (conversationContext.topicId ?? null);

    const fileIdList = files?.map((f) => f.id);

    const hasFile = !!fileIdList && fileIdList.length > 0;

    // if message is empty or no files, then stop
    if (!message && !hasFile) return;

    const expectedConversationVersion =
      capturedConversationVersion ?? (await messageService.getConversationVersion());
    if (!isCurrentConversation()) return;

    if (onlyAddUserMessage) {
      await get().addUserMessage({ expectedConversationVersion, fileList: fileIdList, message });

      return;
    }

    const messages = chatSelectors.activeBaseChats(get());
    const chatConfig = agentChatConfigSelectors.currentChatConfig(getAgentStoreState());
    const autoCreateThreshold =
      chatConfig.autoCreateTopicThreshold ?? DEFAULT_AGENT_CHAT_CONFIG.autoCreateTopicThreshold;
    const shouldCreateNewTopic =
      !activeTopicId &&
      !!chatConfig.enableAutoCreateTopic &&
      messages.length + 2 >= autoCreateThreshold;

    // 构造服务端模式临时消息的本地媒体预览（优先使用 base64Url）
    // Note: base64Url is a self-contained data URL that requires no network fetch.
    // fileUrl is an S3/OSS URL that the server may not be able to fetch (network/credentials).
    // Always prefer base64Url when available to ensure VisionRoutingProcessor can access it.
    const filesInStore = getFileStoreState().chatUploadFileList;
    const getImageUrl = (f: (typeof filesInStore)[0]): string => {
      // Prefer base64Url: self-contained, no network fetch needed
      if (f.base64Url) {
        return f.base64Url;
      }
      // Fall back to fileUrl (S3/OSS URL) - may not be accessible from server
      return f.fileUrl || f.previewUrl || '';
    };
    const tempImages: ChatImageItem[] = filesInStore
      .filter((f) => f.file?.type?.startsWith('image'))
      .map((f) => ({
        id: f.id,
        url: getImageUrl(f),
        alt: f.file?.name || f.id,
      }));
    const tempVideos: ChatVideoItem[] = filesInStore
      .filter((f) => f.file?.type?.startsWith('video'))
      .map((f) => ({
        id: f.id,
        url: f.fileUrl || f.base64Url || f.previewUrl || '',
        alt: f.file?.name || f.id,
      }));

    // use optimistic update to avoid the slow waiting
    const tempId = get().internal_createTmpMessage({
      content: message,
      // if message has attached with files, then add files to message and the agent
      files: fileIdList,
      role: 'user',
      sessionId: activeId,
      // if there is activeTopicId，then add topicId to message
      topicId: activeTopicId,
      threadId: activeThreadId,
      imageList: tempImages.length > 0 ? tempImages : undefined,
      videoList: tempVideos.length > 0 ? tempVideos : undefined,
    });
    get().internal_toggleMessageLoading(true, tempId);

    const operationKey = messageMapKey(activeId, activeTopicId);

    // Start tracking sendMessageInServer operation with AbortController
    const abortController = get().internal_toggleSendMessageOperation(operationKey, true)!;

    const jsonState = mainInputEditor?.getJSONState();
    get().internal_updateSendMessageOperation(
      operationKey,
      { inputSendErrorMsg: undefined, inputEditorTempState: jsonState },
      'creatingMessage/start',
    );

    let data: SendMessageServerResponse | undefined;
    let operationWasCurrent = false;
    const { model, provider } = agentSelectors.currentAgentConfig(getAgentStoreState());
    try {
      data = await aiChatService.sendMessageInServer(
        {
          expectedConversationVersion,
          newUserMessage: {
            content: message,
            files: fileIdList,
          },
          // if there is activeTopicId，then add topicId to message
          topicId: activeTopicId,
          threadId: activeThreadId,
          newTopic: shouldCreateNewTopic
            ? {
                topicMessageIds: messages.map((m) => m.id),
                title: t('defaultTitle', { ns: 'topic' }),
              }
            : undefined,
          sessionId: activeId === INBOX_SESSION_ID ? undefined : activeId,
        },
        abortController,
      );
      if (!isCurrentConversation()) return;

      // refresh the total data
      get().internal_refreshAiChat({
        messages: data.messages,
        topics: data.topics,
        sessionId: activeId,
        topicId: data.topicId,
      });

      if (data.isCreateNewTopic && data.topicId) {
        conversationContext = { ...conversationContext, topicId: data.topicId };
        await get().switchTopic(data.topicId, true);
      }
    } catch (e) {
      if (e instanceof TRPCClientError) {
        const isAbort = e.message.includes('aborted') || e.name === 'AbortError';
        // Check if error is due to cancellation
        const currentOperation = get().mainSendMessageOperations[operationKey];
        const isCurrentOperation =
          isCurrentConversation() && currentOperation?.abortController === abortController;

        if (!isAbort && isCurrentOperation) {
          get().internal_updateSendMessageOperation(operationKey, { inputSendErrorMsg: e.message });
          get().mainInputEditor?.setJSONState(jsonState);
        }
      }
    } finally {
      // Stop tracking sendMessageInServer operation
      const currentOperation = get().mainSendMessageOperations[operationKey];
      const isCurrentOperation =
        isCurrentConversation() && currentOperation?.abortController === abortController;

      if (isCurrentOperation) {
        operationWasCurrent = true;
        get().internal_updateSendMessageOperation(
          operationKey,
          { inputEditorTempState: null },
          'creatingMessage/finished',
        );
        get().internal_toggleSendMessageOperation(operationKey, false);
      }

      if (contextExportCaptureId && isCurrentConversation() && !data) {
        get().completeContextExport(contextExportCaptureId);
      }
    }

    // remove temporally message
    if (data?.isCreateNewTopic && operationWasCurrent && isCurrentConversation()) {
      get().internal_dispatchMessage(
        { type: 'deleteMessage', id: tempId },
        { topicId: activeTopicId, sessionId: activeId },
      );
    }

    if (operationWasCurrent && isCurrentConversation()) {
      get().internal_toggleMessageLoading(false, tempId);
    }

    if (!data || !isCurrentConversation()) return;

    //  update assistant update to make it rerank
    getSessionStoreState().triggerSessionUpdate(conversationContext.sessionId);

    // The current server only returns persisted user history here. Keep filtering the
    // reserved ID for compatibility with an older server during rolling deployments.
    const baseMessages = data.messages.filter((item) => item.id !== data.assistantMessageId);
    const activeContextExportCaptureId =
      contextExportCaptureId ?? (!isWelcomeQuestion ? get().consumeContextExportArm() : undefined);

    const generationOperationKey = data.topicId
      ? messageMapKey(conversationContext.sessionId, data.topicId)
      : undefined;
    const generationOperationId = `server-generation-${nanoid(8)}`;
    if (generationOperationKey && data.topicId) {
      set(
        (state) => ({
          serverGenerationOperations: {
            ...state.serverGenerationOperations,
            [generationOperationKey]: {
              ...state.serverGenerationOperations[generationOperationKey],
              [generationOperationId]: {
                generation: conversationContext.generation,
                operationId: generationOperationId,
                sessionId: conversationContext.sessionId,
                topicId: data.topicId!,
                userScope: requestedScope,
              },
            },
          },
        }),
        false,
        n('serverGeneration/start', {
          operationId: generationOperationId,
          sessionId: conversationContext.sessionId,
          topicId: data.topicId,
        }),
      );
    }

    const summaryTitle = async () => {
      // check activeTopic and then auto update topic title
      if (data.isCreateNewTopic) {
        await get().summaryTopicTitle(data.topicId, data.messages);
        return;
      }

      if (!data.topicId) return;

      const topic = topicSelectors.getTopicById(data.topicId)(get());

      if (topic && !topic.title) {
        const chats = chatSelectors.getBaseChatsByKey(messageMapKey(activeId, topic.id))(get());
        await get().summaryTopicTitle(topic.id, chats);
      }
    };

    summaryTitle().catch(console.error);

    // The send operation's controller was already released in the finally above (and its
    // cancel path only aborts while isLoading), so the pre-send compaction needs its own
    // controller, registered under the conversation key so stopGenerateMessage can reach
    // it. A server-created topic is already folded into conversationContext at this point.
    const compactionKey = messageMapKey(
      conversationContext.sessionId,
      conversationContext.topicId,
    );
    const compactionController = new AbortController();
    const clearCompactionOperation = () => {
      set(
        (state) => {
          if (
            state.preSendCompactionOperations[compactionKey]?.abortController !==
            compactionController
          )
            return state;

          const preSendCompactionOperations = { ...state.preSendCompactionOperations };
          delete preSendCompactionOperations[compactionKey];
          return { preSendCompactionOperations };
        },
        false,
        n('preSendCompaction/end'),
      );
    };

    try {
      set(
        (state) => ({
          preSendCompactionOperations: {
            ...state.preSendCompactionOperations,
            [compactionKey]: {
              abortController: compactionController,
              threadId: activeThreadId ?? null,
            },
          },
        }),
        false,
        n('preSendCompaction/start'),
      );
      try {
        await get().triggerTokenThresholdMemoryCompaction(compactionController);
        if (compactionController.signal.aborted || !isCurrentConversation()) return;

        let placeholderMessages: UIChatMessage[];
        try {
          const placeholder = await aiChatService.createAssistantMessageInServer(
            {
              assistantMessageId: data.assistantMessageId,
              expectedConversationVersion,
              model,
              parentId: data.userMessageId,
              provider: provider!,
              sessionId: activeId === INBOX_SESSION_ID ? undefined : activeId,
              threadId: activeThreadId,
              topicId: data.topicId,
            },
            compactionController,
          );
          placeholderMessages = placeholder.messages;
        } catch (error) {
          if (compactionController.signal.aborted) {
            if (isCurrentConversation()) {
              await get().internal_deleteMessage(data.assistantMessageId);
            }
            return;
          }
          throw error;
        }

        if (compactionController.signal.aborted) {
          if (isCurrentConversation()) {
            await get().internal_deleteMessage(data.assistantMessageId);
          }
          return;
        }
        if (!isCurrentConversation()) return;

        get().internal_refreshAiChat({
          messages: placeholderMessages,
          sessionId: activeId,
          topicId: data.topicId,
        });
      } finally {
        clearCompactionOperation();
      }

      await internal_execAgentRuntime({
        conversationContext,
        contextExportCaptureId: activeContextExportCaptureId,
        expectedConversationVersion,
        messages: baseMessages,
        userMessageId: data.userMessageId,
        assistantMessageId: data.assistantMessageId,
        isWelcomeQuestion,
        ragQuery: get().internal_shouldUseRAG() ? message : undefined,
        threadId: activeThreadId,
      });
      if (!isCurrentConversation()) return;

      //
      // // if there is relative files, then add files to agent
      // // only available in server mode
      const userFiles = chatSelectors.currentUserFiles(get()).map((f) => f.id);

      await getAgentStoreState().addFilesToAgent(userFiles, false);
    } catch (e) {
      console.error(e);
    } finally {
      if (activeContextExportCaptureId && isCurrentConversation()) {
        get().completeContextExport(activeContextExportCaptureId);
      }
      if (generationOperationKey && isCurrentConversation()) {
        set(
          (state) => {
            const currentOperations = state.serverGenerationOperations[generationOperationKey];
            if (!currentOperations?.[generationOperationId]) return state;

            const serverGenerationOperations = { ...state.serverGenerationOperations };
            const remainingOperations = { ...currentOperations };
            delete remainingOperations[generationOperationId];

            if (Object.keys(remainingOperations).length === 0) {
              delete serverGenerationOperations[generationOperationKey];
            } else {
              serverGenerationOperations[generationOperationKey] = remainingOperations;
            }

            return { serverGenerationOperations };
          },
          false,
          n('serverGeneration/end', {
            operationId: generationOperationId,
            sessionId: conversationContext.sessionId,
            topicId: data.topicId,
          }),
        );
      }
    }
  },

  cancelSendMessageInServer: (topicId?: string) => {
    const { activeId, activeTopicId } = get();

    // Determine which operation to cancel
    const targetTopicId = topicId ?? activeTopicId;
    const operationKey = messageMapKey(activeId, targetTopicId);

    // Cancel the specific operation
    get().internal_toggleSendMessageOperation(
      operationKey,
      false,
      'User cancelled sendMessageInServer operation',
    );

    // Only clear creating message state if it's the active session
    if (operationKey === messageMapKey(activeId, activeTopicId)) {
      const editorTempState = get().mainSendMessageOperations[operationKey]?.inputEditorTempState;

      if (editorTempState) get().mainInputEditor?.setJSONState(editorTempState);
    }
  },
  clearSendMessageError: () => {
    get().internal_updateSendMessageOperation(
      { sessionId: get().activeId, topicId: get().activeTopicId },
      null,
      'clearSendMessageError',
    );
  },
  internal_refreshAiChat: ({ topics, messages, sessionId, topicId }) => {
    const normalizedTopics = topics?.map(normalizeTopic);
    const currentTopics = get().topicMaps[sessionId] ?? [];
    const topicsById = new Map(currentTopics.map((topic) => [topic.id, topic]));

    for (const topic of normalizedTopics ?? []) {
      topicsById.set(topic.id, topic);
    }

    set(
      {
        topicMaps: normalizedTopics
          ? { ...get().topicMaps, [sessionId]: [...topicsById.values()] }
          : get().topicMaps,
        messagesMap: { ...get().messagesMap, [messageMapKey(sessionId, topicId)]: messages },
      },
      false,
      'refreshAiChat',
    );
  },

  internal_execAgentRuntime: async (params) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const conversationContext = params.conversationContext ?? {
      generation: get().conversationClearGeneration,
      sessionId: get().activeId,
      topicId: get().activeTopicId,
    };
    const dispatchContext = {
      sessionId: conversationContext.sessionId,
      topicId: conversationContext.topicId,
    };
    const isCurrentConversation = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === conversationContext.generation &&
      get().activeId === conversationContext.sessionId &&
      (get().activeTopicId ?? null) === (conversationContext.topicId ?? null);
    const expectedConversationVersion =
      params.expectedConversationVersion ?? (await messageService.getConversationVersion());
    if (!isCurrentConversation()) return;
    const {
      assistantMessageId: assistantId,
      userMessageId,
      ragQuery,
      messages: originalMessages,
    } = params;
    const {
      internal_fetchAIChatMessage,
      triggerToolCalls,
      refreshMessages,
      internal_updateMessageRAG,
    } = get();

    // create a new array to avoid the original messages array change
    const messages = [...originalMessages];

    const agentStoreState = getAgentStoreState();
    const { model, provider } = agentSelectors.currentAgentConfig(agentStoreState);

    let fileChunks: MessageSemanticSearchChunk[] | undefined;
    let ragQueryId;

    // go into RAG flow if there is ragQuery flag
    if (ragQuery) {
      // 1. get the relative chunks from semantic search
      const { chunks, queryId, rewriteQuery } = await get().internal_retrieveChunks(
        userMessageId,
        ragQuery,
        // should skip the last content
        messages.map((m) => m.content).slice(0, messages.length - 1),
      );
      if (!isCurrentConversation()) return;

      ragQueryId = queryId;

      const lastMsg = messages.pop() as UIChatMessage;

      // 2. build the retrieve context messages
      const knowledgeBaseQAContext = knowledgeBaseQAPrompts({
        chunks,
        userQuery: lastMsg.content,
        rewriteQuery,
        knowledge: agentSelectors.currentEnabledKnowledge(agentStoreState),
      });

      // 3. add the retrieve context messages to the messages history
      messages.push({
        ...lastMsg,
        content: (lastMsg.content + '\n\n' + knowledgeBaseQAContext).trim(),
      });

      fileChunks = chunks.map((c) => ({ id: c.id, similarity: c.similarity }));

      if (fileChunks.length > 0) {
        await internal_updateMessageRAG(assistantId, { ragQueryId, fileChunks });
      }
    }

    // 3. place a search with the search working model if this model is not support tool use
    const aiInfraStoreState = getAiInfraStoreState();
    const isModelSupportToolUse = aiModelSelectors.isModelSupportToolUse(
      model,
      provider!,
    )(aiInfraStoreState);
    const isProviderHasBuiltinSearch = aiProviderSelectors.isProviderHasBuiltinSearch(provider!)(
      aiInfraStoreState,
    );
    const isModelHasBuiltinSearch = aiModelSelectors.isModelHasBuiltinSearch(
      model,
      provider!,
    )(aiInfraStoreState);
    const isModelBuiltinSearchInternal = aiModelSelectors.isModelBuiltinSearchInternal(
      model,
      provider!,
    )(aiInfraStoreState);
    const useModelBuiltinSearch = agentChatConfigSelectors.useModelBuiltinSearch(agentStoreState);
    const modelNativeSearchDisabled = isModelNativeSearchDisabledProvider(provider);
    const useModelSearch = modelNativeSearchDisabled
      ? false
      : ((isProviderHasBuiltinSearch || isModelHasBuiltinSearch) && useModelBuiltinSearch) ||
        isModelBuiltinSearchInternal;
    const isAgentEnableSearch = agentChatConfigSelectors.isAgentEnableSearch(agentStoreState);

    if (isAgentEnableSearch && !useModelSearch && !isModelSupportToolUse) {
      const { model, provider } = agentChatConfigSelectors.searchFCModel(agentStoreState);

      let isToolsCalling = false;
      let isError = false;

      const abortController = get().internal_toggleChatLoading(
        true,
        assistantId,
        n('generateMessage(start)', { messageId: assistantId, messages }),
      );

      get().internal_toggleSearchWorkflow(true, assistantId);
      await chatService.fetchPresetTaskResult({
        params: { messages, model, provider, plugins: [WebBrowsingManifest.identifier] },
        onFinish: async (_, { toolCalls, usage }) => {
          if (!isCurrentConversation()) return;
          if (toolCalls && toolCalls.length > 0) {
            get().internal_toggleToolCallingStreaming(assistantId, undefined);
            // update tools calling
            await get().internal_updateMessageContent(assistantId, '', {
              toolCalls,
              metadata: usage,
              model,
              provider,
              conversationContext,
            });
          }
        },
        trace: {
          traceId: params.traceId,
          sessionId: conversationContext.sessionId,
          topicId: conversationContext.topicId,
          traceName: TraceNameMap.SearchIntentRecognition,
        },
        abortController,
        onMessageHandle: async (chunk) => {
          if (!isCurrentConversation()) return;
          if (chunk.type === 'tool_calls') {
            get().internal_toggleSearchWorkflow(false, assistantId);
            get().internal_toggleToolCallingStreaming(assistantId, chunk.isAnimationActives);
            get().internal_dispatchMessage(
              {
                id: assistantId,
                type: 'updateMessage',
                value: { tools: get().internal_transformToolCalls(chunk.tool_calls) },
              },
              dispatchContext,
            );
            isToolsCalling = true;
          }

          if (chunk.type === 'text') {
            abortController!.abort('not fc');
          }
        },
        onErrorHandle: async (error) => {
          if (!isCurrentConversation()) return;
          isError = true;
          await messageService.updateMessageError(assistantId, error);
          if (isCurrentConversation()) await refreshMessages(conversationContext);
        },
      });

      if (!isCurrentConversation()) return;
      get().internal_toggleChatLoading(
        false,
        assistantId,
        n('generateMessage(start)', { messageId: assistantId, messages }),
      );
      get().internal_toggleSearchWorkflow(false, assistantId);

      // if there is error, then stop
      if (isError) return;

      // if it's the function call message, trigger the function method
      if (isToolsCalling) {
        get().internal_toggleMessageInToolsCalling(true, assistantId);
        await refreshMessages(conversationContext);
        if (!isCurrentConversation()) return;
        await triggerToolCalls(assistantId, {
          contextExportCaptureId: params.contextExportCaptureId,
          expectedConversationVersion,
          threadId: params?.threadId,
          inPortalThread: params?.inPortalThread,
        });

        // then story the workflow
        return;
      }
    }

    // 4. fetch the AI response
    const { isFunctionCall, content, persistenceAmbiguous } = await internal_fetchAIChatMessage({
      conversationContext,
      messages,
      messageId: assistantId,
      params,
      model,
      provider: provider!,
    });
    if (!isCurrentConversation()) return;

    // 5. if it's the function call message, trigger the function method
    if (isFunctionCall) {
      if (persistenceAmbiguous) {
        const { notification } = await import('@/components/AntdStaticMethods');
        notification.warning({
          description: t('assistantToolCallPersistence.description', { ns: 'error' }),
          message: t('assistantToolCallPersistence.title', { ns: 'error' }),
        });
        return;
      }

      get().internal_toggleMessageInToolsCalling(true, assistantId);
      await refreshMessages(conversationContext);
      if (!isCurrentConversation()) return;
      await triggerToolCalls(assistantId, {
        contextExportCaptureId: params.contextExportCaptureId,
        expectedConversationVersion,
        threadId: params?.threadId,
        inPortalThread: params?.inPortalThread,
      });
    } else {
      // 显示桌面通知（仅在桌面端且窗口隐藏时）
      if (isDesktop) {
        try {
          // 动态导入桌面通知服务，避免在非桌面端环境中导入
          const { desktopNotificationService } =
            await import('@/services/electron/desktopNotification');

          await desktopNotificationService.showNotification({
            body: content,
            title: t('notification.finishChatGeneration', { ns: 'electron' }),
          });
        } catch (error) {
          // 静默处理错误，不影响正常流程
          console.error('Desktop notification error:', error);
        }
      }
    }

    if (!params.threadId && !params.inPortalThread) {
      void Promise.resolve(get().triggerMessageCountMemoryCompaction()).catch(console.error);
    }
  },

  internal_updateSendMessageOperation: (key, value, actionName) => {
    const operationKey = typeof key === 'string' ? key : messageMapKey(key.sessionId, key.topicId);

    set(
      produce((draft) => {
        if (!draft.mainSendMessageOperations[operationKey])
          draft.mainSendMessageOperations[operationKey] = value;
        else {
          if (value === null) {
            delete draft.mainSendMessageOperations[operationKey];
          } else {
            draft.mainSendMessageOperations[operationKey] = {
              ...draft.mainSendMessageOperations[operationKey],
              ...value,
            };
          }
        }
      }),
      false,
      actionName ?? n('updateSendMessageOperation', { operationKey, value }),
    );
  },
  internal_toggleSendMessageOperation: (key, loading: boolean, cancelReason?: string) => {
    if (loading) {
      const abortController = new AbortController();

      get().internal_updateSendMessageOperation(
        key,
        { isLoading: true, abortController },
        n('toggleSendMessageOperation(start)', { key }),
      );

      return abortController;
    } else {
      const operationKey =
        typeof key === 'string' ? key : messageMapKey(key.sessionId, key.topicId);

      const operation = get().mainSendMessageOperations[operationKey];

      // If cancelReason is provided, abort the operation first
      if (cancelReason && operation?.isLoading) {
        operation.abortController?.abort(cancelReason);
      }

      get().internal_updateSendMessageOperation(
        key,
        { isLoading: false, abortController: null },
        n('toggleSendMessageOperation(stop)', { key, cancelReason }),
      );

      return undefined;
    }
  },
});
