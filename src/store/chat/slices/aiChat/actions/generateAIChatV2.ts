/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import { DEFAULT_AGENT_CHAT_CONFIG, INBOX_SESSION_ID, MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { knowledgeBaseQAPrompts } from '@lobechat/prompts';
import {
  ChatImageItem,
  ChatTopic,
  ChatVideoItem,
  ContextExportRequestContext,
  type KnowledgeBaseClientPreparationFailurePhase,
  MessageSemanticSearchChunk,
  SendMessageParams,
  SendMessageServerResponse,
  TraceNameMap,
  UIChatMessage,
  buildConversationGenerationLane,
  isConversationGenerationChatFamilyKind,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { TRPCClientError } from '@trpc/client';
import { t } from 'i18next';
import { produce } from 'immer';
import { StateCreator } from 'zustand/vanilla';

import {
  buildDurableConversationConfig,
  isClientDurableConversationGenerationEnabled,
} from '@/helpers/durableConversationGeneration';
import { buildHistorySummaryForRequest } from '@/helpers/memoryArchivePrompt';
import { isModelNativeSearchDisabledProvider } from '@/helpers/modelNativeSearch';
import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { ragService } from '@/services/rag';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { getAgentStoreState } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/slices/chat';
import { aiModelSelectors, aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import {
  CONTEXT_EXPORT_REDACTIONS,
  addKnowledgeDiagnosticIdToError,
  attachKnowledgeBaseExportSummary,
  countKnowledgeBasePromptTokens,
  createKnowledgeBasePreparationMessageError,
  createKnowledgeBaseSummary,
  getKnowledgeDiagnosticIdFromError,
} from '@/store/chat/helpers/knowledgeBaseContext';
import { MainSendMessageOperation } from '@/store/chat/slices/aiChat/initialState';
import type { ChatStore } from '@/store/chat/store';
import type { ConversationContext } from '@/store/chat/types';
import {
  bumpLaneScopedClearGeneration,
  markConversationLaneDurableGenerationStopped,
  resolveConversationClearGeneration,
  supersedeConversationLaneStopMarker,
} from '@/store/chat/utils/conversationClearGeneration';
import { getFileStoreState } from '@/store/file/store';
import { globalHelpers } from '@/store/global/helpers';
import { getSessionStoreState } from '@/store/session';
import { getSkillSelectionKey, getSkillStoreState } from '@/store/skill';
import { useUserStore } from '@/store/user';
import { WebBrowsingManifest } from '@/tools/web-browsing';
import { normalizeTopic } from '@/utils/client/topic';
import { setNamespace } from '@/utils/storeDebug';

import { chatSelectors, topicSelectors } from '../../../selectors';
import { messageMapKey } from '../../../utils/messageMapKey';
import { notifyToolCallPersistenceFailure } from './persistenceNotification';

const n = setNamespace('ai');

const USER_CANCELLED_SEND = 'User cancelled sendMessageInServer operation';

const isUserCancelledSend = (error: unknown, abortController: AbortController) => {
  const reason = abortController.signal.reason;
  if (reason === MESSAGE_CANCEL_FLAT || reason === USER_CANCELLED_SEND) return true;
  return (
    error instanceof Error &&
    (error.message === MESSAGE_CANCEL_FLAT || error.message === USER_CANCELLED_SEND)
  );
};

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
  cancelSendMessageInServer: (topicId?: string) => Promise<void>;
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
    activatedSkillIds?: string[];
    conversationContext?: ConversationContext;
    contextExportCaptureId?: string;
    contextExportRequest?: ContextExportRequestContext;
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
    activatedSkillIds,
    contextExportCaptureId,
    expectedConversationVersion: capturedConversationVersion,
    files,
    isWelcomeQuestion,
    message,
    metadata,
    onlyAddUserMessage,
  }) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const {
      activeTopicId,
      activeId,
      activeSessionType,
      activeThreadId,
      internal_execAgentRuntime,
      mainInputEditor,
    } = get();
    if (!accountMutationSnapshot || !activeId) return;
    const requestedScope = accountMutationSnapshot.scope;
    let conversationContext: ConversationContext = {
      clearGeneration: resolveConversationClearGeneration(
        get(),
        activeId,
        activeTopicId,
        activeThreadId ?? null,
      ),
      generation: get().conversationNavigationGeneration,
      sessionId: activeId,
      threadId: activeThreadId ?? null,
      topicId: activeTopicId,
    };
    const isCurrentConversation = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      resolveConversationClearGeneration(
        get(),
        conversationContext.sessionId,
        conversationContext.topicId,
        conversationContext.threadId ?? null,
      ) === conversationContext.clearGeneration &&
      get().activeId === conversationContext.sessionId &&
      (get().activeTopicId ?? null) === (conversationContext.topicId ?? null);
    const isSameAccount = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot);

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

    const messageMetadata =
      metadata || activatedSkillIds?.length
        ? {
            ...metadata,
            ...(activatedSkillIds?.length
              ? { skills: { activated: [...new Set(activatedSkillIds)] } }
              : {}),
          }
        : undefined;

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
      ...(messageMetadata && { metadata: messageMetadata }),
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
    let sendFailure: unknown;
    let recoveryChecked = false;
    let operationWasCurrent = false;
    const agentConfig = agentSelectors.currentAgentConfig(getAgentStoreState());
    const { model, provider } = agentConfig;
    const activeTopic = activeTopicId
      ? topicSelectors.getTopicById(activeTopicId)(get())
      : undefined;
    const enableHistoryCompaction =
      !!activeTopicId &&
      activeSessionType !== 'group' &&
      !activeThreadId &&
      !!chatConfig.enableHistoryCount &&
      !!chatConfig.enableCompressHistory;
    const historySummary = buildHistorySummaryForRequest({
      archives: activeTopic?.metadata?.memoryArchives,
      enableCompressHistory: enableHistoryCompaction,
      enableUserMemoryArchive: chatConfig.enableUserMemoryArchive,
      topicSummary: activeTopic?.historySummary,
    });
    const generation =
      isClientDurableConversationGenerationEnabled() &&
      model &&
      provider &&
      get().contextExportCaptureStatus !== 'armed'
        ? {
            config: buildDurableConversationConfig({
              activatedSkillIds,
              agentConfig: { ...agentConfig, model, provider },
              chatConfig,
              enableMemoryTool:
                chatConfig.enableAssistantMemory !== false && activeSessionType !== 'group',
              fetchOnClient:
                aiProviderSelectors.isProviderFetchOnClient(provider)(getAiInfraStoreState()),
              historySummary,
              historySummaryLastMessageId: enableHistoryCompaction
                ? activeTopic?.metadata?.historySummaryLastMessageId
                : undefined,
              isWelcomeQuestion,
              locale: globalHelpers.getCurrentLanguage(),
              ragQuery: get().internal_shouldUseRAG() ? message : undefined,
              systemRole: agentSelectors.currentAgentSystemRole(getAgentStoreState()),
            }),
            idempotencyKey: `chat-send:${tempId}`,
          }
        : undefined;
    try {
      data = await aiChatService.sendMessageInServer(
        {
          expectedConversationVersion,
          ...(generation ? { generation } : {}),
          newUserMessage: {
            content: message,
            files: fileIdList,
            ...(messageMetadata && { metadata: messageMetadata }),
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

      // Persist the server rows into the conversation that sent them even if the
      // user already switched topic or session. Attach below still needs this map.
      if (isSameAccount()) {
        get().internal_refreshAiChat({
          messages: data.messages,
          topics: data.topics,
          sessionId: conversationContext.sessionId,
          topicId: data.topicId,
        });
      }

      if (data.isCreateNewTopic && data.topicId) {
        const stillOnSendingConversation = isCurrentConversation();
        conversationContext = { ...conversationContext, topicId: data.topicId };
        if (stillOnSendingConversation) {
          await get().switchTopic(data.topicId, true);
          if (isCurrentConversation()) {
            getSkillStoreState().moveSelectedSkills(
              getSkillSelectionKey({
                sessionId: activeId,
                threadId: activeThreadId,
                topicId: activeTopicId,
              }),
              getSkillSelectionKey({
                sessionId: activeId,
                threadId: activeThreadId,
                topicId: data.topicId,
              }),
            );
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isAbort = errorMessage.includes('aborted') || (error as Error)?.name === 'AbortError';
      const userCancelled = isUserCancelledSend(error, abortController);

      if (generation?.idempotencyKey && (!isAbort || !userCancelled)) {
        try {
          const recovered = await conversationGenerationService.getOperationByIdempotencyKey(
            generation.idempotencyKey,
          );
          recoveryChecked = true;
          if (recovered?.assistantMessageId && recovered.userMessageId && isSameAccount()) {
            data = {
              assistantMessageId: recovered.assistantMessageId,
              isCreateNewTopic: shouldCreateNewTopic,
              messages: [],
              operation: recovered,
              operationId: recovered.id,
              topicId: recovered.topicId || activeTopicId || '',
              userMessageId: recovered.userMessageId,
            };
            await get().refreshMessages(conversationContext);
          }
        } catch {
          // The reconciliation request is itself ambiguous; retain the optimistic row.
        }
      }

      if (!data) {
        sendFailure = error;
        const currentOperation = get().mainSendMessageOperations[operationKey];
        const isCurrentOperation = currentOperation?.abortController === abortController;

        if (!isAbort && isCurrentOperation && isCurrentConversation()) {
          get().internal_updateSendMessageOperation(operationKey, {
            inputSendErrorMsg: errorMessage,
          });
          get().mainInputEditor?.setJSONState(jsonState);
        }
      }
    } finally {
      const currentOperation = get().mainSendMessageOperations[operationKey];
      const isTrackedOperation = currentOperation?.abortController === abortController;

      if (isTrackedOperation) {
        operationWasCurrent = isCurrentConversation();
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

    if (
      sendFailure &&
      !data &&
      operationWasCurrent &&
      isCurrentConversation() &&
      (recoveryChecked || sendFailure instanceof TRPCClientError)
    ) {
      get().internal_dispatchMessage(
        { id: tempId, type: 'deleteMessage' },
        { sessionId: activeId, topicId: activeTopicId },
      );
    }

    if (data?.isCreateNewTopic) {
      get().internal_dispatchMessage(
        { type: 'deleteMessage', id: tempId },
        { topicId: activeTopicId, sessionId: activeId },
      );
    }

    get().internal_toggleMessageLoading(false, tempId);

    if (!data) return;

    if (isSameAccount() && isCurrentConversation()) {
      //  update assistant update to make it rerank
      getSessionStoreState().triggerSessionUpdate(conversationContext.sessionId);
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

    const isLateDurableAttachCurrent = () =>
      isSameAccount() &&
      resolveConversationClearGeneration(
        get(),
        conversationContext.sessionId,
        conversationContext.topicId,
        conversationContext.threadId ?? null,
      ) === conversationContext.clearGeneration;

    if (data.operationId) {
      if (isLateDurableAttachCurrent()) {
        const durableOperation = data.operation;
        get().attachConversationGeneration({
          assistantMessageId: durableOperation?.assistantMessageId || data.assistantMessageId,
          clearGeneration: conversationContext.clearGeneration,
          generation: conversationContext.generation,
          kind: durableOperation?.kind || 'chat',
          lane:
            durableOperation?.lane ||
            buildConversationGenerationLane({
              kind: durableOperation?.kind || 'chat',
              sessionId: activeId === INBOX_SESSION_ID ? undefined : activeId,
              threadId: activeThreadId,
              topicId: data.topicId,
              userId: requestedScope,
            }),
          laneGeneration: durableOperation?.laneGeneration,
          operationId: data.operationId,
          revision: durableOperation?.revision,
          sessionId: conversationContext.sessionId,
          threadId: durableOperation?.threadId || activeThreadId,
          topicId: data.topicId,
          userScope: requestedScope,
        });
        set(
          (state) =>
            supersedeConversationLaneStopMarker(
              state,
              conversationContext.sessionId,
              conversationContext.topicId,
              conversationContext.threadId ?? null,
              data.operationId,
            ),
          false,
          n('sendMessageInServer/supersedeLaneStopMarker'),
        );
        await get().reconcileConversationGeneration(data.operationId).catch(console.error);
        if (isCurrentConversation()) {
          const userFiles = chatSelectors.currentUserFiles(get()).map((f) => f.id);
          await getAgentStoreState().addFilesToAgent(userFiles, false);
        }
      }
      return;
    }

    if (isClientDurableConversationGenerationEnabled() && model && provider) {
      await get().syncActiveConversationGenerations();
      const durableKey = messageMapKey(conversationContext.sessionId, data.topicId);
      const attached = Object.values(get().serverGenerationOperations[durableKey] || {});
      if (attached.some((operation) => isConversationGenerationChatFamilyKind(operation.kind))) {
        if (isCurrentConversation()) {
          const userFiles = chatSelectors.currentUserFiles(get()).map((f) => f.id);
          await getAgentStoreState().addFilesToAgent(userFiles, false);
        }
        return;
      }
    }

    if (!isCurrentConversation()) return;

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
                clearGeneration: conversationContext.clearGeneration,
                generation: conversationContext.generation,
                kind: 'chat',
                lane: `browser:${generationOperationId}`,
                operationId: generationOperationId,
                sessionId: conversationContext.sessionId,
                threadId: activeThreadId,
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

    summaryTitle().catch(console.error);

    // The send operation's controller was already released in the finally above (and its
    // cancel path only aborts while isLoading), so the pre-send compaction needs its own
    // controller, registered under the conversation key so stopGenerateMessage can reach
    // it. A server-created topic is already folded into conversationContext at this point.
    const compactionKey = messageMapKey(conversationContext.sessionId, conversationContext.topicId);
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
        activatedSkillIds,
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

  cancelSendMessageInServer: async (topicId?: string) => {
    const { activeId, activeTopicId, activeThreadId } = get();

    const targetTopicId = topicId ?? activeTopicId;
    const targetThreadId = activeThreadId ?? null;
    const operationKey = messageMapKey(activeId, targetTopicId);

    set(
      (state) => ({
        ...bumpLaneScopedClearGeneration(state, activeId, targetTopicId, targetThreadId),
        ...markConversationLaneDurableGenerationStopped(
          state,
          activeId,
          targetTopicId,
          targetThreadId,
        ),
      }),
      false,
      n('cancelSendMessageInServer/bumpLaneScopedClearGeneration'),
    );

    await get().cancelActiveDurableOpsInScope({
      sessionId: activeId,
      threadId: targetThreadId,
      topicId: targetTopicId,
    });

    get().internal_toggleSendMessageOperation(operationKey, false, USER_CANCELLED_SEND);

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
      clearGeneration: resolveConversationClearGeneration(
        get(),
        get().activeId,
        get().activeTopicId,
        params.threadId ?? get().activeThreadId ?? null,
      ),
      generation: get().conversationNavigationGeneration,
      sessionId: get().activeId,
      threadId: params.threadId ?? get().activeThreadId ?? null,
      topicId: get().activeTopicId,
    };
    const dispatchContext = {
      sessionId: conversationContext.sessionId,
      topicId: conversationContext.topicId,
    };
    const isCurrentConversation = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      resolveConversationClearGeneration(
        get(),
        conversationContext.sessionId,
        conversationContext.topicId,
        conversationContext.threadId ?? null,
      ) === conversationContext.clearGeneration &&
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
    let knowledgeBasePromptTokens = 0;
    let contextExportRequest =
      params.contextExportCaptureId && ragQuery
        ? get().createContextExportRequest(params.contextExportCaptureId, 'assistant', 'initial')
        : params.contextExportRequest;
    let runtimeParams = contextExportRequest ? { ...params, contextExportRequest } : params;

    // go into RAG flow if there is ragQuery flag
    if (ragQuery) {
      let diagnosticId: string | undefined;
      let failurePhase: KnowledgeBaseClientPreparationFailurePhase = 'retrieval';
      try {
        // 1. get the relative chunks from semantic search
        const {
          chunks,
          diagnosticId: retrievalDiagnosticId,
          queryId,
          retrieval,
          rewriteQuery,
          scope,
        } = await get().internal_retrieveChunks(
          userMessageId,
          ragQuery,
          // should skip the last content
          messages.map((m) => m.content).slice(0, messages.length - 1),
        );
        if (!isCurrentConversation()) return;

        diagnosticId = retrievalDiagnosticId;

        ragQueryId = queryId;

        const lastMsg = messages.pop() as UIChatMessage;

        // 2. build the retrieve context messages
        failurePhase = 'prompt_assembly';
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

        failurePhase = 'token_accounting';
        const { countMode, promptTokens } =
          await countKnowledgeBasePromptTokens(knowledgeBaseQAContext);
        knowledgeBasePromptTokens = promptTokens;
        if (!isCurrentConversation()) return;
        failurePhase = 'message_metadata';
        const summary = createKnowledgeBaseSummary({
          countMode,
          diagnosticId,
          promptTokens: knowledgeBasePromptTokens,
          queryRewritten: !!rewriteQuery && rewriteQuery !== ragQuery,
          retrieval,
          scope,
        });
        contextExportRequest = attachKnowledgeBaseExportSummary(contextExportRequest, summary);
        runtimeParams = contextExportRequest ? { ...params, contextExportRequest } : params;

        if (diagnosticId) {
          void ragService
            .reportKnowledgeClientEvent({
              chunkCount: chunks.length,
              countMode,
              diagnosticId,
              event: 'prompt_injection_reported',
              promptTokens: knowledgeBasePromptTokens,
              queryRewritten: summary.queryRewritten,
            })
            .catch(() => {});
        }

        fileChunks = chunks.map((c) => ({ id: c.id, similarity: c.similarity }));

        if (fileChunks.length > 0) {
          await internal_updateMessageRAG(assistantId, { ragQueryId, fileChunks });
        }
      } catch (error) {
        diagnosticId = diagnosticId || getKnowledgeDiagnosticIdFromError(error);
        if (!diagnosticId) {
          try {
            const report = await ragService.reportKnowledgeClientEvent({
              event: 'client_preparation_failed',
              failurePhase,
            });
            diagnosticId = report.diagnosticId;
          } catch {
            // Diagnostics are best effort and must not mask the RAG failure.
          }
        } else {
          void ragService
            .reportKnowledgeClientEvent({
              diagnosticId,
              event: 'client_preparation_failed',
              failurePhase,
            })
            .catch(() => {});
        }

        if (contextExportRequest) {
          get().appendContextExportSnapshot({
            ...contextExportRequest,
            error: diagnosticId
              ? `Knowledge Base preparation failed (Diagnostic ID: ${diagnosticId})`
              : 'Knowledge Base preparation failed',
            redactions: CONTEXT_EXPORT_REDACTIONS,
            status: 'error',
          });
        }

        const preparationError = addKnowledgeDiagnosticIdToError(error, diagnosticId);
        if (isCurrentConversation()) {
          const messageError = createKnowledgeBasePreparationMessageError(diagnosticId);
          get().internal_dispatchMessage(
            { id: assistantId, type: 'updateMessage', value: { error: messageError } },
            dispatchContext,
          );

          try {
            await messageService.updateMessageError(assistantId, messageError);
            if (isCurrentConversation()) await refreshMessages(conversationContext);
          } catch (persistenceError) {
            console.error('Failed to persist Knowledge Base preparation error', persistenceError);
          }
        }

        throw preparationError;
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
        conversationContext.threadId ?? null,
      );

      get().internal_toggleSearchWorkflow(true, assistantId);
      if (knowledgeBasePromptTokens > 0) {
        get().internal_setKnowledgeBaseContextTokens(
          conversationContext,
          knowledgeBasePromptTokens,
        );
      }
      try {
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
            topicId: conversationContext.topicId ?? undefined,
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
      } finally {
        if (knowledgeBasePromptTokens > 0) {
          get().internal_setKnowledgeBaseContextTokens(conversationContext, 0);
        }
        get().internal_toggleChatLoading(
          false,
          assistantId,
          n('generateMessage(start)', { messageId: assistantId, messages }),
          conversationContext.threadId ?? null,
        );
        get().internal_toggleSearchWorkflow(false, assistantId);
      }

      if (!isCurrentConversation()) return;

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
    if (knowledgeBasePromptTokens > 0) {
      get().internal_setKnowledgeBaseContextTokens(conversationContext, knowledgeBasePromptTokens);
    }
    let fetchResult: Awaited<ReturnType<typeof internal_fetchAIChatMessage>>;
    try {
      fetchResult = await internal_fetchAIChatMessage({
        conversationContext,
        messages,
        messageId: assistantId,
        // Keep params intact because it carries activatedSkillIds through the server-mode runtime.
        params: runtimeParams,
        model,
        provider: provider!,
      });
    } finally {
      if (knowledgeBasePromptTokens > 0) {
        get().internal_setKnowledgeBaseContextTokens(conversationContext, 0);
      }
    }
    const { isFunctionCall, persistenceAmbiguous, persistenceFailure } = fetchResult;
    if (!isCurrentConversation()) return;

    // 5. if it's the function call message, trigger the function method
    if (isFunctionCall) {
      if (persistenceAmbiguous) {
        await notifyToolCallPersistenceFailure(persistenceFailure);
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
