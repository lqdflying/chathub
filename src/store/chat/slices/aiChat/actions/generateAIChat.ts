/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import { LOADING_FLAT, MESSAGE_CANCEL_FLAT, INBOX_SESSION_ID } from '@lobechat/const';
import { knowledgeBaseQAPrompts } from '@lobechat/prompts';
import {
  ChatImageItem,
  ContextExportRequestContext,
  CreateMessageParams,
  type KnowledgeBaseClientPreparationFailurePhase,
  MessageSemanticSearchChunk,
  SendMessageParams,
  ToolCacheDebugMetadata,
  TraceEventType,
  TraceNameMap,
  UIChatMessage,
} from '@lobechat/types';
import { produce } from 'immer';
import { StateCreator } from 'zustand/vanilla';

import { normalizeAssistantMemoryText } from '@/helpers/assistantMemory';
import { getMessagesAfterHistorySummaryCursor } from '@/helpers/contextCompaction';
import { conversationGenerationIdempotencyKey } from '@/helpers/conversationGenerationIdempotency';
import {
  buildDurableConversationConfig,
  isClientDurableConversationGenerationEnabled,
} from '@/helpers/durableConversationGeneration';
import { buildHistorySummaryForRequest } from '@/helpers/memoryArchivePrompt';
import { isModelNativeSearchDisabledProvider } from '@/helpers/modelNativeSearch';
import { chatService } from '@/services/chat';
import { tryEnqueueConversationGeneration } from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { ragService } from '@/services/rag';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra';
import { getAiInfraStoreState } from '@/store/aiInfra/store';
import {
  CONTEXT_EXPORT_REDACTIONS,
  addKnowledgeDiagnosticIdToError,
  attachKnowledgeBaseExportSummary,
  countKnowledgeBasePromptTokens,
  createKnowledgeBaseSummary,
  getKnowledgeDiagnosticIdFromError,
} from '@/store/chat/helpers/knowledgeBaseContext';
import { ChatStore } from '@/store/chat/store';
import type { ConversationContext } from '@/store/chat/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getFileStoreState } from '@/store/file/store';
import { globalHelpers } from '@/store/global/helpers';
import { useUserStore } from '@/store/user';
import { WebBrowsingManifest } from '@/tools/web-browsing';
import { Action, setNamespace } from '@/utils/storeDebug';

import { chatSelectors, topicSelectors } from '../../../selectors';
import { notifyToolCallPersistenceFailure } from './persistenceNotification';

const n = setNamespace('ai');

const RETRY_LOADING_KEYS = [
  'chatLoadingIds',
  'messageLoadingIds',
  'messageEditingIds',
  'reasoningLoadingIds',
  'messageInToolsCallingIds',
  'messageRAGLoadingIds',
  'searchWorkflowLoadingIds',
  'pluginApiLoadingIds',
] as const;

const resolveRetryAnchor = (messages: UIChatMessage[], messageId: string) => {
  const currentIndex = messages.findIndex(({ id }) => id === messageId);
  if (currentIndex < 0) return;

  const currentMessage = messages[currentIndex];
  if (currentMessage.role === 'user') return { index: currentIndex, message: currentMessage };

  if (currentMessage.parentId) {
    const parentIndex = messages.findIndex(
      ({ id, role }) => id === currentMessage.parentId && role === 'user',
    );
    if (parentIndex >= 0) return { index: parentIndex, message: messages[parentIndex] };
  }

  for (let index = currentIndex - 1; index >= 0; index--) {
    if (messages[index].role === 'user') return { index, message: messages[index] };
  }
};

const collectDependentRewindIds = (
  initialMessageIds: string[],
  messages: UIChatMessage[],
  threads: Array<{ id: string; parentThreadId?: string | null; sourceMessageId: string }>,
) => {
  const messageIds = new Set(initialMessageIds);
  const threadIds = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;

    for (const thread of threads) {
      if (threadIds.has(thread.id)) continue;
      if (
        messageIds.has(thread.sourceMessageId) ||
        (thread.parentThreadId && threadIds.has(thread.parentThreadId))
      ) {
        threadIds.add(thread.id);
        changed = true;
      }
    }

    for (const message of messages) {
      if (message.threadId && threadIds.has(message.threadId) && !messageIds.has(message.id)) {
        messageIds.add(message.id);
        changed = true;
      }
    }
  }

  return { messageIds, threadIds };
};

interface ProcessMessageParams {
  activatedSkillIds?: string[];
  conversationContext?: ConversationContext;
  contextExportCaptureId?: string;
  contextExportRequest?: ContextExportRequestContext;
  expectedConversationVersion?: number;
  traceId?: string;
  isWelcomeQuestion?: boolean;
  inSearchWorkflow?: boolean;
  /** Automatic continuation after one or more tool results */
  isToolContinuation?: boolean;
  toolCacheDebug?: ToolCacheDebugMetadata;
  /**
   * the RAG query content, should be embedding and used in the semantic search
   */
  ragQuery?: string;
  threadId?: string;
  inPortalThread?: boolean;

  groupId?: string;
  agentId?: string;
  agentConfig?: any; // Agent configuration for group chat agents
}

export interface AIGenerateAction {
  /**
   * Sends a new message to the AI chat system
   */
  sendMessage: (params: SendMessageParams) => Promise<void>;
  /**
   * Regenerates a specific message in the chat
   */
  regenerateMessage: (id: string) => Promise<void>;
  /**
   * Deletes an existing message and generates a new one in its place
   */
  delAndRegenerateMessage: (id: string) => Promise<void>;
  /**
   * Interrupts the ongoing ai message generation process
   */
  stopGenerateMessage: (options?: { threadId?: string | null }) => Promise<void>;

  // =========  ↓ Internal Method ↓  ========== //
  // ========================================== //
  // ========================================== //

  /**
   * Executes the core processing logic for AI messages
   * including preprocessing and postprocessing steps
   */
  internal_coreProcessMessage: (
    messages: UIChatMessage[],
    parentId: string,
    params?: ProcessMessageParams,
  ) => Promise<void>;
  /**
   * Retrieves an AI-generated chat message from the backend service
   */
  internal_fetchAIChatMessage: (input: {
    conversationContext?: ConversationContext;
    messages: UIChatMessage[];
    messageId: string;
    params?: ProcessMessageParams;
    model: string;
    provider: string;
  }) => Promise<{
    isFunctionCall: boolean;
    content: string;
    persistenceAmbiguous?: boolean;
    persistenceFailure?: { bodyKind: string; httpStatus?: number };
    traceId?: string;
  }>;
  /**
   * Resends a specific message, optionally using a trace ID for tracking
   */
  internal_resendMessage: (
    id: string,
    params?: {
      traceId?: string;
      messages?: UIChatMessage[];
      threadId?: string;
      inPortalThread?: boolean;
    },
  ) => Promise<void>;
  /**
   * Toggles the loading state for AI message generation, managing the UI feedback
   */
  internal_toggleChatLoading: (
    loading: boolean,
    id?: string,
    action?: Action,
  ) => AbortController | undefined;
  internal_toggleMessageInToolsCalling: (
    loading: boolean,
    id?: string,
    action?: Action,
  ) => AbortController | undefined;
  /**
   * Controls the streaming state of tool calling processes, updating the UI accordingly
   */
  internal_toggleToolCallingStreaming: (id: string, streaming: boolean[] | undefined) => void;
  /**
   * Toggles the loading state for AI message reasoning, managing the UI feedback
   */
  internal_toggleChatReasoning: (
    loading: boolean,
    id?: string,
    action?: string,
  ) => AbortController | undefined;

  internal_toggleSearchWorkflow: (loading: boolean, id?: string) => void;
}

export const generateAIChat: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  AIGenerateAction
> = (set, get) => ({
  delAndRegenerateMessage: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const traceId = chatSelectors.getTraceIdByMessageId(id)(get());
    // trace the delete and regenerate message
    get().internal_traceMessage(id, { eventType: TraceEventType.DeleteAndRegenerateMessage });
    await get().internal_resendMessage(id, { traceId });
  },
  regenerateMessage: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const traceId = chatSelectors.getTraceIdByMessageId(id)(get());
    // trace the delete and regenerate message
    get().internal_traceMessage(id, { eventType: TraceEventType.RegenerateMessage });
    await get().internal_resendMessage(id, { traceId });
  },

  sendMessage: async ({
    activatedSkillIds,
    message,
    metadata,
    files,
    onlyAddUserMessage,
    isWelcomeQuestion,
  }) => {
    const { activeId, sendMessageInServer } = get();
    const hasFile = !!files?.length;
    if (!activeId || (!message && !hasFile)) return;

    const expectedConversationVersion = await messageService.getConversationVersion();

    return sendMessageInServer({
      activatedSkillIds,
      expectedConversationVersion,
      files,
      isWelcomeQuestion,
      message,
      metadata,
      onlyAddUserMessage,
    });
  },
  stopGenerateMessage: async (options) => {
    // abort only a pre-send compaction registered for the CURRENT conversation AND the same
    // thread context that started it. A Stop from another session/topic uses a different key;
    // a Stop from a thread portal (threadId set) shares the conversation key but must not kill
    // the main send's compaction — pre-send compaction only ever runs for the main
    // conversation (threadId null), so it matches a main Stop and never a thread Stop.
    const { activeId, activeTopicId, preSendCompactionOperations } = get();
    const preSendCompaction = preSendCompactionOperations[messageMapKey(activeId, activeTopicId)];
    if (preSendCompaction && (preSendCompaction.threadId ?? null) === (options?.threadId ?? null)) {
      preSendCompaction.abortController.abort(MESSAGE_CANCEL_FLAT);
    }

    await get().stopDurableConversationGeneration(options);

    const { chatLoadingIdsAbortController, internal_toggleChatLoading } = get();

    if (!chatLoadingIdsAbortController) return;

    chatLoadingIdsAbortController.abort(MESSAGE_CANCEL_FLAT);

    internal_toggleChatLoading(false, undefined, n('stopGenerateMessage') as string);
  },

  // the internal process method of the AI message
  internal_coreProcessMessage: async (originalMessages, userMessageId, params) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const { internal_fetchAIChatMessage, triggerToolCalls, refreshMessages } = get();
    const conversationContext = params?.conversationContext ?? {
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
      params?.expectedConversationVersion ?? (await messageService.getConversationVersion());
    if (!isCurrentConversation()) return;

    // create a new array to avoid the original messages array change
    const messages = [...originalMessages];

    const agentStoreState = getAgentStoreState();
    const agentConfig = agentSelectors.currentAgentConfig(agentStoreState);
    const chatConfig = agentChatConfigSelectors.currentChatConfig(agentStoreState);
    const { model, provider } = agentConfig;
    const activeTopic = conversationContext.topicId
      ? topicSelectors.getTopicById(conversationContext.topicId)(get())
      : undefined;
    const isRegularTopicRequest =
      !!conversationContext.topicId &&
      get().activeSessionType !== 'group' &&
      !params?.threadId &&
      !params?.inPortalThread &&
      !params?.groupId &&
      !params?.agentId &&
      !messages.some(({ groupId }) => !!groupId);
    const enableHistoryCompaction =
      isRegularTopicRequest &&
      !!chatConfig.enableHistoryCount &&
      !!chatConfig.enableCompressHistory;
    const historySummary = buildHistorySummaryForRequest({
      archives: activeTopic?.metadata?.memoryArchives,
      enableCompressHistory: enableHistoryCompaction,
      enableUserMemoryArchive: chatConfig.enableUserMemoryArchive,
      topicSummary: activeTopic?.historySummary,
    });

    if (isClientDurableConversationGenerationEnabled() && model && provider) {
      const operation = await tryEnqueueConversationGeneration({
        config: buildDurableConversationConfig({
          activatedSkillIds: params?.activatedSkillIds,
          agentConfig: { ...agentConfig, model, provider },
          chatConfig,
          enableMemoryTool:
            chatConfig.enableAssistantMemory !== false &&
            get().activeSessionType !== 'group' &&
            !params?.groupId &&
            !params?.agentId &&
            !messages.some(({ groupId }) => !!groupId),
          fetchOnClient: aiProviderSelectors.isProviderFetchOnClient(provider)(
            getAiInfraStoreState(),
          ),
          historySummary,
          historySummaryLastMessageId: enableHistoryCompaction
            ? activeTopic?.metadata?.historySummaryLastMessageId
            : undefined,
          isWelcomeQuestion: params?.isWelcomeQuestion,
          locale: globalHelpers.getCurrentLanguage(),
          ragQuery: params?.ragQuery,
          systemRole: agentSelectors.currentAgentSystemRole(agentStoreState),
        }),
        conversationVersion: expectedConversationVersion,
        expectedConversationVersion,
        idempotencyKey: conversationGenerationIdempotencyKey(
          params?.isToolContinuation ? 'continue' : 'chat',
          userMessageId,
        ),
        kind: params?.isToolContinuation ? 'continue' : 'chat',
        parentMessageId: userMessageId,
        replaceActive: true,
        sessionId:
          conversationContext.sessionId === INBOX_SESSION_ID
            ? undefined
            : conversationContext.sessionId,
        threadId: params?.threadId,
        topicId: conversationContext.topicId ?? undefined,
        userMessageId,
      });
      if (operation) {
        get().attachConversationGeneration({
          assistantMessageId: operation.assistantMessageId || undefined,
          generation: conversationContext.generation,
          kind: operation.kind,
          lane: operation.lane,
          laneGeneration: operation.laneGeneration,
          operationId: operation.id,
          revision: operation.revision,
          sessionId: conversationContext.sessionId,
          threadId: operation.threadId || undefined,
          topicId: conversationContext.topicId ?? undefined,
          userScope: accountMutationSnapshot.scope,
        });
        if (!isCurrentConversation()) return;
        await refreshMessages();
        return;
      }
    }

    let fileChunks: MessageSemanticSearchChunk[] | undefined;
    let ragQueryId;
    let knowledgeBasePromptTokens = 0;
    let contextExportRequest =
      params?.contextExportCaptureId && params.ragQuery
        ? get().createContextExportRequest(
            params.contextExportCaptureId,
            params.agentId ? 'member' : 'assistant',
            params.isToolContinuation ? 'tool' : 'initial',
          )
        : params?.contextExportRequest;
    let runtimeParams = contextExportRequest ? { ...params, contextExportRequest } : params;

    // go into RAG flow if there is ragQuery flag
    if (params?.ragQuery) {
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
          params?.ragQuery,
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
          queryRewritten: !!rewriteQuery && rewriteQuery !== params.ragQuery,
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
        throw addKnowledgeDiagnosticIdToError(error, diagnosticId);
      }
    }

    // 2. Add an empty message to place the AI response
    const assistantMessage: CreateMessageParams = {
      role: 'assistant',
      content: LOADING_FLAT,
      fromModel: model,
      fromProvider: provider,

      parentId: userMessageId,
      sessionId: conversationContext.sessionId,
      topicId: conversationContext.topicId ?? undefined,
      threadId: params?.threadId,
      fileChunks,
      ragQueryId,
    };

    const assistantId = await get().internal_createMessage(assistantMessage, {
      conversationContext,
      expectedConversationVersion,
    });

    if (!assistantId || !isCurrentConversation()) return;

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
            traceId: params?.traceId,
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
      }

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
          contextExportCaptureId: params?.contextExportCaptureId,
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
      try {
        await refreshMessages(conversationContext);
      } catch {
        // Persistence is confirmed; revalidation must not block execution.
      }
      if (!isCurrentConversation()) return;
      await triggerToolCalls(assistantId, {
        contextExportCaptureId: params?.contextExportCaptureId,
        expectedConversationVersion,
        threadId: params?.threadId,
        inPortalThread: params?.inPortalThread,
      });
    }

    if (!params?.isToolContinuation && !params?.threadId && !params?.inPortalThread) {
      void Promise.resolve(get().triggerMessageCountMemoryCompaction()).catch(console.error);
    }
  },
  internal_fetchAIChatMessage: async ({
    conversationContext: requestedConversationContext,
    messages,
    messageId,
    params,
    provider,
    model,
  }) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return { content: '', isFunctionCall: false };

    const {
      internal_toggleChatLoading,
      refreshMessages,
      internal_updateMessageContent,
      internal_dispatchMessage,
      internal_toggleToolCallingStreaming,
      internal_toggleChatReasoning,
    } = get();
    const conversationContext = requestedConversationContext ??
      params?.conversationContext ?? {
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
    if (!isCurrentConversation()) {
      return { content: '', isFunctionCall: false };
    }

    const abortController = internal_toggleChatLoading(
      true,
      messageId,
      n('generateMessage(start)', { messageId, messages }),
    );

    const agentStoreState = getAgentStoreState();
    const agentConfig = params?.agentConfig || agentSelectors.currentAgentConfig(agentStoreState);
    // Use the target agent's own chat config for member/agent-scoped requests instead of
    // leaking the host session's config (mirrors currentChatConfig's raw `|| {}` shape).
    const chatConfig = params?.agentConfig
      ? params.agentConfig.chatConfig || {}
      : agentChatConfigSelectors.currentChatConfig(agentStoreState);

    // ================================== //
    //   messages uniformly preprocess    //
    // ================================== //
    // 4. handle max_tokens
    agentConfig.params.max_tokens = chatConfig.enableMaxTokens
      ? agentConfig.params.max_tokens
      : undefined;

    // 5. handle reasoning_effort
    agentConfig.params.reasoning_effort = chatConfig.enableReasoningEffort
      ? agentConfig.params.reasoning_effort
      : undefined;

    let isFunctionCall = false;
    let persistenceAmbiguous = false;
    let persistenceFailure: { bodyKind: string; httpStatus?: number } | undefined;
    let msgTraceId: string | undefined;
    let output = '';
    let thinking = '';
    let thinkingStartAt: number;
    let duration: number;
    // to upload image
    const uploadTasks: Map<string, Promise<{ id?: string; url?: string }>> = new Map();

    const activeTopic = conversationContext.topicId
      ? topicSelectors.getTopicById(conversationContext.topicId)(get())
      : undefined;
    const isRegularTopicRequest =
      !!conversationContext.topicId &&
      get().activeSessionType !== 'group' &&
      !params?.threadId &&
      !params?.inPortalThread &&
      !params?.groupId &&
      !params?.agentId &&
      !messages.some(({ groupId }) => !!groupId);
    const enableHistoryCompaction =
      isRegularTopicRequest &&
      !!agentChatConfigSelectors.enableHistoryCount(agentStoreState) &&
      !!chatConfig.enableCompressHistory;
    const historySummaryForRequest = buildHistorySummaryForRequest({
      archives: activeTopic?.metadata?.memoryArchives,
      enableCompressHistory: enableHistoryCompaction,
      enableUserMemoryArchive: chatConfig.enableUserMemoryArchive,
      topicSummary: activeTopic?.historySummary,
    });
    // Two-tier assistant memory for the target agent (member requests carry their own
    // config via params.agentConfig); injected by AgentMemoryProvider, separate from
    // the topic history summary. Absent flag means enabled (default true).
    const agentMemoryForRequest =
      chatConfig.enableAssistantMemory === false
        ? {}
        : {
            dynamicMemory: normalizeAssistantMemoryText(agentConfig.assistantMemory) || undefined,
            fixedMemory: (agentConfig.fixedMemory ?? '').trim() || undefined,
          };
    const requestMessages = enableHistoryCompaction
      ? getMessagesAfterHistorySummaryCursor(
          messages,
          activeTopic?.metadata?.historySummaryLastMessageId,
        )
      : messages;
    // the implicit save-memory tool writes to the ACTIVE session's agent, so it is
    // offered only for that agent's own sends (never group/member requests)
    const enableMemoryTool =
      chatConfig.enableAssistantMemory !== false &&
      get().activeSessionType !== 'group' &&
      !params?.groupId &&
      !params?.agentId &&
      !messages.some(({ groupId }) => !!groupId);
    const contextExportRequest =
      params?.contextExportRequest ??
      (params?.contextExportCaptureId
        ? get().createContextExportRequest(
            params.contextExportCaptureId,
            params.agentId ? 'member' : 'assistant',
            params.isToolContinuation ? 'tool' : 'initial',
          )
        : undefined);
    try {
      await chatService.createAssistantMessageStream({
        abortController,
        agentMemory: agentMemoryForRequest,
        contextExportRequest,
        enableMemoryTool,
        activatedSkillIds: params?.activatedSkillIds,
        params: {
          messages: requestMessages,
          model,
          provider,
          ...agentConfig.params,
          plugins: agentConfig.plugins,
        },
        historySummary: historySummaryForRequest,
        onContextEngineered: ({ engineeredInput, metadata, request }) => {
          if (!isCurrentConversation()) return;
          get().appendContextExportSnapshot({
            ...request,
            engineeredInput,
            metadata,
            redactions: [
              'credentials',
              'transportHeaders',
              'transportOptions',
              'baseUrls',
              'signalsAndCallbacks',
              'storedIdentifiers',
              'traceAndDiagnostics',
              'cacheRouting',
              'inlineMediaData',
            ],
            status: 'capturing',
          });
        },
        onContextSnapshot: (snapshot) => {
          if (!isCurrentConversation()) return;
          get().appendContextExportSnapshot(snapshot);
        },
        toolCacheDebug: params?.toolCacheDebug,
        trace: {
          traceId: params?.traceId,
          sessionId: conversationContext.sessionId,
          topicId: conversationContext.topicId ?? undefined,
          traceName: TraceNameMap.Conversation,
        },
        isWelcomeQuestion: params?.isWelcomeQuestion,
        onErrorHandle: async (error) => {
          if (!isCurrentConversation()) return;
          if (contextExportRequest) {
            get().appendContextExportSnapshot({
              ...contextExportRequest,
              error: `Provider request failed: ${String(error.type)}`,
              redactions: [
                'credentials',
                'transportHeaders',
                'transportOptions',
                'baseUrls',
                'signalsAndCallbacks',
                'storedIdentifiers',
                'traceAndDiagnostics',
                'cacheRouting',
                'inlineMediaData',
              ],
              status: 'error',
            });
          }
          await messageService.updateMessageError(messageId, error);
          if (isCurrentConversation()) await refreshMessages(conversationContext);
        },
        onFinish: async (
          content,
          { traceId, observationId, toolCalls, reasoning, grounding, usage, speed },
        ) => {
          if (!isCurrentConversation()) return;
          msgTraceId = traceId ?? undefined;

          // 等待所有图片上传完成
          let finalImages: ChatImageItem[] = [];

          if (uploadTasks.size > 0) {
            try {
              // 等待所有上传任务完成
              const uploadResults = await Promise.all(uploadTasks.values());

              // 使用上传后的 S3 URL 替换原始图像数据
              finalImages = uploadResults.filter((i) => !!i.url) as ChatImageItem[];
            } catch (error) {
              console.error('Error waiting for image uploads:', error);
            }
          }
          if (!isCurrentConversation()) return;

          let parsedToolCalls = toolCalls;
          if (parsedToolCalls && parsedToolCalls.length > 0) {
            internal_toggleToolCallingStreaming(messageId, undefined);
            parsedToolCalls = parsedToolCalls.map((item) => ({
              ...item,
              function: {
                ...item.function,
                arguments: !!item.function.arguments ? item.function.arguments : '{}',
              },
            }));
            isFunctionCall = true;
          }

          // update the content after fetch result
          const finalization = await internal_updateMessageContent(messageId, content, {
            toolCalls: parsedToolCalls,
            reasoning: !!reasoning ? { ...reasoning, duration } : undefined,
            search: !!grounding?.citations ? grounding : undefined,
            imageList: finalImages.length > 0 ? finalImages : undefined,
            metadata: speed ? { ...usage, ...speed } : usage,
            model,
            observationId: observationId ?? undefined,
            provider,
            persistenceRecovery: 'assistant_finalization',
            traceId: traceId ?? undefined,
            conversationContext,
          });
          if (!isCurrentConversation()) return;
          persistenceAmbiguous = finalization.persistenceAmbiguous;
          persistenceFailure = finalization.failure;
        },
        onMessageHandle: async (chunk) => {
          if (!isCurrentConversation()) return;
          switch (chunk.type) {
            case 'grounding': {
              // if there is no citations, then stop
              if (
                !chunk.grounding ||
                !chunk.grounding.citations ||
                chunk.grounding.citations.length <= 0
              )
                return;

              internal_dispatchMessage(
                {
                  id: messageId,
                  type: 'updateMessage',
                  value: {
                    search: {
                      citations: chunk.grounding.citations,
                      searchQueries: chunk.grounding.searchQueries,
                    },
                  },
                },
                dispatchContext,
              );
              break;
            }

            case 'base64_image': {
              internal_dispatchMessage(
                {
                  id: messageId,
                  type: 'updateMessage',
                  value: {
                    imageList: chunk.images.map((i) => ({ id: i.id, url: i.data, alt: i.id })),
                  },
                },
                dispatchContext,
              );
              const image = chunk.image;

              const task = getFileStoreState()
                .uploadBase64FileWithProgress(image.data)
                .then((value) => ({
                  id: value?.id,
                  url: value?.url,
                  alt: value?.filename || value?.id,
                }));

              uploadTasks.set(image.id, task);

              break;
            }

            case 'text': {
              output += chunk.text;

              // if there is no duration, it means the end of reasoning
              if (!duration) {
                duration = Date.now() - thinkingStartAt;

                const isInChatReasoning = chatSelectors.isMessageInChatReasoning(messageId)(get());
                if (isInChatReasoning) {
                  internal_toggleChatReasoning(
                    false,
                    messageId,
                    n('toggleChatReasoning/false') as string,
                  );
                }
              }

              internal_dispatchMessage(
                {
                  id: messageId,
                  type: 'updateMessage',
                  value: {
                    content: output,
                    reasoning: !!thinking ? { content: thinking, duration } : undefined,
                  },
                },
                dispatchContext,
              );
              break;
            }

            case 'reasoning': {
              // if there is no thinkingStartAt, it means the start of reasoning
              if (!thinkingStartAt) {
                thinkingStartAt = Date.now();
                internal_toggleChatReasoning(
                  true,
                  messageId,
                  n('toggleChatReasoning/true') as string,
                );
              }

              thinking += chunk.text;

              internal_dispatchMessage(
                {
                  id: messageId,
                  type: 'updateMessage',
                  value: { reasoning: { content: thinking } },
                },
                dispatchContext,
              );
              break;
            }

            // is this message is just a tool call
            case 'tool_calls': {
              internal_toggleToolCallingStreaming(messageId, chunk.isAnimationActives);
              internal_dispatchMessage(
                {
                  id: messageId,
                  type: 'updateMessage',
                  value: { tools: get().internal_transformToolCalls(chunk.tool_calls) },
                },
                dispatchContext,
              );
              isFunctionCall = true;
            }
          }
        },
      });
    } finally {
      if (isCurrentConversation()) {
        internal_toggleToolCallingStreaming(messageId, undefined);
        internal_toggleChatReasoning(
          false,
          messageId,
          n('generateMessage(reasoningEnd)') as string,
        );
        internal_toggleChatLoading(false, messageId, n('generateMessage(end)') as string);
      }
    }

    return {
      isFunctionCall,
      persistenceAmbiguous,
      persistenceFailure,
      traceId: msgTraceId,
      content: output,
    };
  },

  internal_resendMessage: async (
    messageId,
    { traceId, messages: outChats, threadId: outThreadId, inPortalThread } = {},
  ) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const chats = outChats ?? chatSelectors.mainAIChats(get());
    const anchor = resolveRetryAnchor(chats, messageId);
    if (!anchor || get().messageRetryingIds.length > 0) return;

    const state = get();
    const activeId = state.activeId;
    const activeTopicId = state.activeTopicId;
    const requestedGeneration = state.conversationClearGeneration;
    const isCurrentConversation = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === activeId &&
      get().activeTopicId === activeTopicId;
    const expectedConversationVersion = await messageService.getConversationVersion();
    if (!isCurrentConversation()) return;
    const contextMessages = chats.slice(0, anchor.index + 1);
    const tailMessages = chats.slice(anchor.index + 1);
    const chatKey = messageMapKey(activeId, activeTopicId);
    const currentMessages = state.messagesMap[chatKey] || [];
    const currentThreads = activeTopicId ? state.threadMaps[activeTopicId] || [] : [];
    const optimisticRewind = collectDependentRewindIds(
      tailMessages.map(({ id }) => id),
      currentMessages,
      currentThreads,
    );
    const originalMessages = currentMessages;
    const originalThreads = currentThreads;
    const originalActiveThreadId = state.activeThreadId;
    const originalPortalThreadId = state.portalThreadId;
    const originalThreadStartMessageId = state.threadStartMessageId;
    const originalShowPortal = state.showPortal;
    const originalPortalMessageDetail = state.portalMessageDetail;
    const originalPortalToolMessage = state.portalToolMessage;
    const originalSendMessageOperation = state.mainSendMessageOperations[chatKey];
    const isGroupChat = state.activeSessionType === 'group' || !!anchor.message.groupId;
    const groupId = anchor.message.groupId || activeId;
    const supervisorTodoKey = messageMapKey(groupId, activeTopicId);
    const originalSupervisorTodos = state.supervisorTodos[supervisorTodoKey];
    const requestedThreadId = outThreadId ?? state.activeThreadId;
    let rewindPersisted = false;

    set(
      { messageRetryingIds: [...state.messageRetryingIds, anchor.message.id] },
      false,
      n('retryMessage/start'),
    );

    try {
      // Cancel every producer that could append diagnostics or tool output to the discarded tail.
      state.chatLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
      state.messageInToolsCallingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
      for (const controller of Object.values(state.pluginApiAbortControllers)) {
        controller.abort(MESSAGE_CANCEL_FLAT);
      }
      state.reasoningLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
      state.searchWorkflowLoadingIdsAbortController?.abort(MESSAGE_CANCEL_FLAT);
      await get().cancelAndDetachDurableOps({
        groupId: isGroupChat ? groupId : undefined,
        sessionId: activeId,
        threadId: requestedThreadId,
        topicId: activeTopicId,
      });
      get().internal_toggleChatLoading(false, undefined, n('retryMessage/cancelChatLoading'));
      get().internal_toggleMessageInToolsCalling(false, undefined, n('retryMessage/cancelTools'));
      get().internal_togglePluginApiCalling(false, undefined, n('retryMessage/cancelPlugin'));
      get().internal_toggleChatReasoning(false, undefined, n('retryMessage/cancelReasoning'));
      get().internal_toggleSearchWorkflow(false);
      const operation = state.mainSendMessageOperations[chatKey];
      if (operation?.isLoading) {
        get().internal_toggleSendMessageOperation(chatKey, false, MESSAGE_CANCEL_FLAT);
      }
      if (isGroupChat) {
        get().internal_cancelSupervisorDecision(groupId);
        get().internal_updateSupervisorTodos(groupId, activeTopicId, []);
      }

      const discardedIds = optimisticRewind.messageIds;
      const discardedThreadIds = optimisticRewind.threadIds;
      const activeTopic = topicSelectors.currentActiveTopic(get());
      if (activeTopic?.historySummary || activeTopic?.metadata?.historySummaryLastMessageId) {
        await get()
          .internal_invalidateMemoryCompaction([...discardedIds])
          .catch(console.error);
      }
      set(
        produce((draft: ChatStore) => {
          draft.messagesMap[chatKey] = (draft.messagesMap[chatKey] || []).filter(
            ({ id }) => !discardedIds.has(id),
          );
          if (activeTopicId) {
            draft.threadMaps[activeTopicId] = (draft.threadMaps[activeTopicId] || []).filter(
              ({ id }) => !discardedThreadIds.has(id),
            );
          }

          for (const key of RETRY_LOADING_KEYS) {
            draft[key] = draft[key].filter((id) => !discardedIds.has(id)) as never;
          }
          for (const id of discardedIds) delete draft.toolCallingStreamIds[id];
          draft.chatLoadingIdsAbortController = undefined;
          draft.messageInToolsCallingIdsAbortController = undefined;
          draft.pluginApiAbortControllers = {};
          draft.reasoningLoadingIdsAbortController = undefined;
          draft.searchWorkflowLoadingIdsAbortController = undefined;
          draft.threadLoadingIds = draft.threadLoadingIds.filter(
            (id) => !discardedThreadIds.has(id),
          );
          if (draft.mainSendMessageOperations[chatKey]) {
            draft.mainSendMessageOperations[chatKey].inputSendErrorMsg = undefined;
          }

          if (draft.portalMessageDetail && discardedIds.has(draft.portalMessageDetail)) {
            draft.portalMessageDetail = undefined;
            draft.showPortal = false;
          }
          if (draft.portalToolMessage && discardedIds.has(draft.portalToolMessage.id)) {
            draft.portalToolMessage = undefined;
            draft.showPortal = false;
          }

          if (draft.activeThreadId && discardedThreadIds.has(draft.activeThreadId)) {
            draft.activeThreadId = undefined;
          }
          if (draft.portalThreadId && discardedThreadIds.has(draft.portalThreadId)) {
            draft.portalThreadId = undefined;
            draft.threadStartMessageId = undefined;
            draft.showPortal = false;
          }
        }),
        false,
        n('retryMessage/optimisticRewind'),
      );

      const persistentTailIds = tailMessages
        .map(({ id }) => id)
        .filter((id) => !id.startsWith('tmp_'));
      const persisted =
        persistentTailIds.length > 0
          ? await messageService.rewindMessages(persistentTailIds)
          : { messageIds: [], threadIds: [] };
      rewindPersisted = true;
      if (!isCurrentConversation()) return;

      // The database is authoritative and may discover dependent threads not present in this tab.
      if (persisted.messageIds.length > 0 || persisted.threadIds.length > 0) {
        const persistedMessageIds = new Set(persisted.messageIds);
        const persistedThreadIds = new Set(persisted.threadIds);
        const isOriginalChatActive =
          get().activeId === activeId && get().activeTopicId === activeTopicId;
        set(
          produce((draft: ChatStore) => {
            draft.messagesMap[chatKey] = (draft.messagesMap[chatKey] || []).filter(
              ({ id }) => !persistedMessageIds.has(id),
            );
            if (activeTopicId) {
              draft.threadMaps[activeTopicId] = (draft.threadMaps[activeTopicId] || []).filter(
                ({ id }) => !persistedThreadIds.has(id),
              );
            }
            if (isOriginalChatActive) {
              if (draft.activeThreadId && persistedThreadIds.has(draft.activeThreadId)) {
                draft.activeThreadId = undefined;
              }
              if (draft.portalThreadId && persistedThreadIds.has(draft.portalThreadId)) {
                draft.portalThreadId = undefined;
                draft.threadStartMessageId = undefined;
                draft.showPortal = false;
              }
              if (draft.portalMessageDetail && persistedMessageIds.has(draft.portalMessageDetail)) {
                draft.portalMessageDetail = undefined;
                draft.showPortal = false;
              }
              if (draft.portalToolMessage && persistedMessageIds.has(draft.portalToolMessage.id)) {
                draft.portalToolMessage = undefined;
                draft.showPortal = false;
              }
            }
          }),
          false,
          n('retryMessage/reconcile'),
        );
      }

      // Do not refresh or write into whichever chat the user navigated to mid-rewind.
      if (!isCurrentConversation()) return;

      await Promise.all([get().refreshMessages(), get().refreshThreads()]);

      if (!isCurrentConversation()) return;

      if (isGroupChat) {
        await get().internal_routeGroupUserMessage(
          groupId,
          { content: anchor.message.content, targetId: anchor.message.targetId },
          true,
          expectedConversationVersion,
        );
        return;
      }

      const threadId =
        anchor.message.threadId ?? (tailMessages.length === 0 ? requestedThreadId : undefined);

      const agentConfig = agentSelectors.currentAgentConfig(getAgentStoreState());
      const chatConfig = agentChatConfigSelectors.currentChatConfig(getAgentStoreState());
      const enableHistoryCompaction =
        !!activeTopicId &&
        get().activeSessionType !== 'group' &&
        !threadId &&
        !!chatConfig.enableHistoryCount &&
        !!chatConfig.enableCompressHistory;
      if (
        isClientDurableConversationGenerationEnabled() &&
        agentConfig.model &&
        agentConfig.provider
      ) {
        const operation = await tryEnqueueConversationGeneration({
          config: buildDurableConversationConfig({
            agentConfig: {
              ...agentConfig,
              model: agentConfig.model,
              provider: agentConfig.provider,
            },
            chatConfig,
            enableMemoryTool:
              chatConfig.enableAssistantMemory !== false && get().activeSessionType !== 'group',
            fetchOnClient: aiProviderSelectors.isProviderFetchOnClient(agentConfig.provider)(
              getAiInfraStoreState(),
            ),
            historySummary: buildHistorySummaryForRequest({
              archives: activeTopic?.metadata?.memoryArchives,
              enableCompressHistory: enableHistoryCompaction,
              enableUserMemoryArchive: chatConfig.enableUserMemoryArchive,
              topicSummary: activeTopic?.historySummary,
            }),
            historySummaryLastMessageId: enableHistoryCompaction
              ? activeTopic?.metadata?.historySummaryLastMessageId
              : undefined,
            locale: globalHelpers.getCurrentLanguage(),
            ragQuery: get().internal_shouldUseRAG() ? anchor.message.content : undefined,
            systemRole: agentSelectors.currentAgentSystemRole(getAgentStoreState()),
          }),
          conversationVersion: expectedConversationVersion,
          expectedConversationVersion,
          idempotencyKey: conversationGenerationIdempotencyKey('regenerate', anchor.message.id),
          kind: 'regenerate',
          parentMessageId: anchor.message.id,
          replaceActive: true,
          sessionId: activeId === INBOX_SESSION_ID ? undefined : activeId,
          threadId,
          topicId: activeTopicId,
          userMessageId: anchor.message.id,
        });
        if (operation) {
          get().attachConversationGeneration({
            assistantMessageId: operation.assistantMessageId || undefined,
            generation: requestedGeneration,
            kind: operation.kind,
            lane: operation.lane,
            laneGeneration: operation.laneGeneration,
            operationId: operation.id,
            revision: operation.revision,
            sessionId: activeId,
            threadId: operation.threadId || undefined,
            topicId: activeTopicId,
            userScope: accountMutationSnapshot.scope,
          });
          await get().refreshMessages();
          return;
        }
      }

      await get().internal_coreProcessMessage(contextMessages, anchor.message.id, {
        expectedConversationVersion,
        traceId,
        ragQuery: get().internal_shouldUseRAG() ? anchor.message.content : undefined,
        threadId,
        inPortalThread: inPortalThread && !!threadId,
      });
    } catch (error) {
      if (!isCurrentConversation()) return;

      if (!rewindPersisted) {
        const isOriginalChatActive =
          get().activeId === activeId && get().activeTopicId === activeTopicId;
        set(
          produce((draft: ChatStore) => {
            draft.messagesMap[chatKey] = originalMessages;
            if (activeTopicId) draft.threadMaps[activeTopicId] = originalThreads;
            if (isOriginalChatActive) {
              draft.activeThreadId = originalActiveThreadId;
              draft.portalThreadId = originalPortalThreadId;
              draft.threadStartMessageId = originalThreadStartMessageId;
              draft.showPortal = originalShowPortal;
              draft.portalMessageDetail = originalPortalMessageDetail;
              draft.portalToolMessage = originalPortalToolMessage;
            }
            if (originalSendMessageOperation) {
              draft.mainSendMessageOperations[chatKey] = originalSendMessageOperation;
            }
            if (isGroupChat) {
              draft.supervisorTodos[supervisorTodoKey] = originalSupervisorTodos || [];
            }
          }),
          false,
          n('retryMessage/rollback'),
        );
      }
      if (isCurrentConversation()) {
        await Promise.allSettled([get().refreshMessages(), get().refreshThreads()]);
      }
      console.error(
        rewindPersisted
          ? 'Conversation was rewound, but regeneration failed:'
          : 'Failed to rewind conversation before retrying:',
        error,
      );
    } finally {
      if (isCurrentConversation()) {
        set(
          {
            messageRetryingIds: get().messageRetryingIds.filter((id) => id !== anchor.message.id),
          },
          false,
          n('retryMessage/end'),
        );
      }
    }
  },

  // ----- Loading ------- //
  internal_toggleChatLoading: (loading, id, action) => {
    return get().internal_toggleLoadingArrays('chatLoadingIds', loading, id, action);
  },
  internal_toggleMessageInToolsCalling: (loading, id) => {
    return get().internal_toggleLoadingArrays('messageInToolsCallingIds', loading, id);
  },
  internal_toggleChatReasoning: (loading, id, action) => {
    return get().internal_toggleLoadingArrays('reasoningLoadingIds', loading, id, action);
  },
  internal_toggleToolCallingStreaming: (id, streaming) => {
    set(
      {
        toolCallingStreamIds: produce(get().toolCallingStreamIds, (draft) => {
          if (!!streaming) {
            draft[id] = streaming;
          } else {
            delete draft[id];
          }
        }),
      },

      false,
      `toggleToolCallingStreaming/${!!streaming ? 'start' : 'end'}`,
    );
  },

  internal_toggleSearchWorkflow: (loading, id) => {
    return get().internal_toggleLoadingArrays('searchWorkflowLoadingIds', loading, id);
  },
});
