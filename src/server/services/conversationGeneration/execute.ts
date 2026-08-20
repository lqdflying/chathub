import { LOADING_FLAT } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import {
  buildGroupChatSystemPrompt,
  chainLangDetect,
  chainSummaryHistory,
  chainSummaryTitle,
  chainTranslate,
  contextSupervisorMakeDecision,
  filterMessagesForAgent,
  knowledgeBaseQAPrompts,
} from '@lobechat/prompts';
import type {
  ChatToolPayload,
  ChatTopicMetadata,
  ConversationGenerationError,
  ConversationGenerationOperation,
  ToolCacheDebugMetadata,
  UIChatMessage,
} from '@lobechat/types';
import { isActiveConversationGenerationStatus } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { ChunkModel } from '@/database/models/chunk';
import { ConversationGenerationModel } from '@/database/models/conversationGeneration';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { idGenerator } from '@/database/utils/idGenerator';
import {
  CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
  createCompactionFingerprint,
  splitCompactionBatches,
} from '@/helpers/contextCompaction';
import {
  applySupervisorToolCalls,
  formatSupervisorTodoContent,
  parseSupervisorTodosFromMessages,
  shouldAvoidSupervisorDecision,
} from '@/helpers/supervisorTodos';
import {
  createKnowledgeDiagnosticId,
  describeKnowledgeDebugError,
  isKnowledgeDebugEnabled,
  logKnowledgeDebugSafe,
  runWithKnowledgeDebugOperation,
} from '@/libs/logger/knowledgeDebug';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { AiChatService } from '@/server/services/aiChat';
import {
  ConversationWriteRejectedError,
  getConversationVersion,
  withConversationWriteLockOrThrow,
} from '@/server/services/conversationWriteLock';
import { RagEmbeddingService, resolveRagEmbeddingConfig } from '@/server/services/rag/embedding';
import { composeSystemRole } from '@/services/chat/composeSystemRole';

import {
  annotateAssistantError,
  clearUnfinishedPlaceholders,
  createAssistantMessageAndAssign,
  ensureOwnedAssistantPlaceholder,
  finalizeOperationWithCleanup,
  resolveLatestAssistantMessageId,
} from './assistantPlaceholders';
import { buildConversationCompactionMetadata } from './compaction';
import {
  CONVERSATION_GENERATION_CHECKPOINT_CHARS,
  CONVERSATION_GENERATION_CHECKPOINT_MS,
  CONVERSATION_GENERATION_HEARTBEAT_MS,
  CONVERSATION_GENERATION_MAX_ATTEMPTS,
  CONVERSATION_GENERATION_MAX_SUPERVISOR_ROUNDS,
  CONVERSATION_GENERATION_MAX_TOOL_TURNS,
  CONVERSATION_GENERATION_STALE_PROCESSING_MS,
} from './constants';
import { loadConversationRuntimeState, resolveConversationRuntimePayload } from './credentials';
import { buildConversationChatPayload } from './payload';
import {
  createConversationRuntimeChatOptions,
  type ConversationRuntimeChatOptionsInput,
} from './runtimeChatOptions';
import { consumeProtocolResponse } from './stream';
import { loadConversationThreadMessages } from './threadScope';
import {
  createConversationToolBatchCorrelation,
  reportConversationToolBatch,
  reportConversationToolCompletion,
  toConversationToolCacheMetadata,
} from './toolDiagnostics';
import { executeConversationToolStep, resolveConversationToolHttpMcp } from './tools';

export const shouldCreateToolContinuation = (remainingTurns: number, shouldContinue: boolean) =>
  shouldContinue && remainingTurns > 0;

export const CONVERSATION_GENERATION_TURN_COMPLETE = 'conversationGenerationTurnComplete';

export const excludeOwnedAssistantMessages = (
  messages: UIChatMessage[],
  assistantId?: string | null,
) => (assistantId ? messages.filter((item) => item.id !== assistantId) : messages);

export const isConversationGenerationTurnComplete = (
  assistant?: { metadata?: Record<string, unknown> | null } | null,
) => assistant?.metadata?.[CONVERSATION_GENERATION_TURN_COMPLETE] === true;

export const resolveChatResumeAction = (
  assistant?: {
    content?: string | null;
    metadata?: Record<string, unknown> | null;
    tools?: unknown[] | null;
  } | null,
): 'generate' | 'continue-tools' | 'complete' => {
  if (!assistant) return 'generate';
  if (Array.isArray(assistant.tools) && assistant.tools.length > 0) return 'continue-tools';
  if (isConversationGenerationTurnComplete(assistant)) return 'complete';
  return 'generate';
};

export const shouldGenerateConversationTitle = ({
  force,
  isWelcomeQuestion,
  title,
}: {
  force?: boolean;
  isWelcomeQuestion?: boolean;
  title?: string | null;
}) => !isWelcomeQuestion && (Boolean(force) || !title?.trim());

const toError = (error: unknown): ConversationGenerationError => ({
  body: error instanceof Error ? { name: error.name } : undefined,
  message: error instanceof Error ? error.message : String(error),
  type: error instanceof ConversationWriteRejectedError ? 'ConversationCleared' : 'GenerationError',
});

export const executeConversationGeneration = async ({
  db,
  operationId,
  userId,
}: {
  db: LobeChatDatabase;
  operationId: string;
  userId: string;
}) => {
  const model = new ConversationGenerationModel(db, userId);
  const operation = await model.findById(operationId);
  if (!operation) return;
  if (!isActiveConversationGenerationStatus(operation.status)) return;

  if (operation.status === 'cancelling' || operation.cancelRequestedAt) {
    await finalize(model, operation, 'cancelled', undefined, db);
    return;
  }

  const claimed = await model.claimForProcessing(operationId);
  if (!claimed) {
    const current = await model.findById(operationId);
    if (
      current &&
      (current.status === 'cancelling' || current.cancelRequestedAt) &&
      isActiveConversationGenerationStatus(current.status)
    ) {
      await finalize(model, current, 'cancelled', undefined, db);
      return;
    }
    if (current?.status === 'processing') {
      const heartbeatAt = current.heartbeatAt ? new Date(current.heartbeatAt).getTime() : 0;
      if (!heartbeatAt || Date.now() - heartbeatAt >= CONVERSATION_GENERATION_STALE_PROCESSING_MS) {
        throw new Error('Stale conversation generation is still marked processing.');
      }
    }
    return;
  }

  if (
    await model.isSupersededByLaneGeneration({
      id: claimed.id,
      lane: claimed.lane,
      laneGeneration: claimed.laneGeneration ?? 1,
    })
  ) {
    await finalizeIfStopped(model, claimed, 'superseded', db);
    return;
  }

  const runAbortController = new AbortController();
  const heartbeatTimer = setInterval(() => {
    void model
      .touchHeartbeat(claimed.id, claimed.attempt)
      .then((row) => {
        if (!row && !runAbortController.signal.aborted) {
          runAbortController.abort('heartbeat_lost');
        }
      })
      .catch((error) => {
        console.warn('[conversation-generation] heartbeat failed', {
          error: error instanceof Error ? error.message : String(error),
          operationId: claimed.id,
        });
        if (!runAbortController.signal.aborted) {
          runAbortController.abort('heartbeat_lost');
        }
      });
  }, CONVERSATION_GENERATION_HEARTBEAT_MS);
  heartbeatTimer.unref?.();

  try {
    switch (claimed.kind) {
      case 'topic_title': {
        await executeTitle(db, claimed, { runSignal: runAbortController.signal });
        break;
      }
      case 'translation': {
        await executeTranslation(db, claimed, { runSignal: runAbortController.signal });
        break;
      }
      case 'tts': {
        await executeTts(db, claimed, { runSignal: runAbortController.signal });
        break;
      }
      case 'memory_compaction': {
        await executeCompaction(db, claimed, { runSignal: runAbortController.signal });
        break;
      }
      case 'rag': {
        await executeRag(db, claimed);
        break;
      }
      case 'group_supervisor': {
        await executeSupervisor(db, claimed, { runSignal: runAbortController.signal });
        break;
      }
      default: {
        await executeChat(db, claimed, { runSignal: runAbortController.signal });
      }
    }
  } catch (error) {
    const stopReason = await shouldStopGeneration(
      db,
      model,
      claimed,
      runAbortController.signal,
    );
    if (stopReason) {
      await finalizeIfStopped(model, claimed, stopReason, db);
      if (stopReason === 'retrying') throw error;
      return;
    }

    const latestAssistantId =
      (await resolveLatestAssistantMessageId(db, claimed)) ?? claimed.assistantMessageId;
    const normalizedError = toError(error);
    if (error instanceof ConversationWriteRejectedError) {
      await finalize(model, claimed, 'interrupted', normalizedError, db, latestAssistantId);
      return;
    }

    if (claimed.attempt < CONVERSATION_GENERATION_MAX_ATTEMPTS) {
      const pending = await model.markForRetry(claimed.id, normalizedError, claimed.attempt);
      if (pending) {
        await model.insertEvent({
          operationId: claimed.id,
          payload: {
            attempt: claimed.attempt,
            error: normalizedError,
            status: 'pending',
          },
          revision: pending.revision,
          type: 'status',
        });
        throw error instanceof Error ? error : new Error(String(error));
      }
    }

    await finalize(model, claimed, 'failed', normalizedError, db, latestAssistantId);
  } finally {
    clearInterval(heartbeatTimer);
  }
};

const emit = async (
  model: ConversationGenerationModel,
  operation: ConversationGenerationOperation,
  type: 'status' | 'snapshot' | 'delta' | 'error' | 'done',
  payload: Record<string, unknown>,
) => {
  const bumped = await model.bumpRevision(operation.id, {
    attempt: operation.attempt,
    laneGeneration: operation.laneGeneration,
  });
  if (!bumped) return;
  const revision = bumped.revision;
  await model.insertEvent({
    operationId: operation.id,
    payload,
    revision,
    type,
  });
  return revision;
};

const updateOperation = async (
  model: ConversationGenerationModel,
  operation: ConversationGenerationOperation,
  value: Parameters<ConversationGenerationModel['update']>[1],
) => {
  const updated = await model.update(operation.id, value, {
    attempt: operation.attempt,
    laneGeneration: operation.laneGeneration,
  });
  if (!updated) throw new Error('Conversation generation attempt no longer owns the operation.');
  return updated;
};

const finalize = async (
  model: ConversationGenerationModel,
  operation: ConversationGenerationOperation,
  status: 'succeeded' | 'cancelled' | 'failed' | 'interrupted',
  error?: ConversationGenerationError,
  db?: LobeChatDatabase,
  annotateMessageId?: string | null,
  extraMessageIds?: Array<string | null | undefined>,
) => {
  if (db) {
    const updated = await finalizeOperationWithCleanup({
      annotateMessageId,
      db,
      error,
      extraMessageIds,
      operation,
      status,
    });
    return Boolean(updated);
  }
  const updated = await model.finalizeActive(operation.id, status, error, {
    attempt: operation.attempt,
    laneGeneration: operation.laneGeneration,
  });
  if (!updated) return false;
  await model.insertEvent({
    operationId: operation.id,
    payload: {
      error,
      status,
    },
    revision: updated.revision,
    type: status === 'failed' ? 'error' : 'done',
  });
  return true;
};

type ConversationGenerationStopReason =
  | 'cancelled'
  | 'conversation_cleared'
  | 'retrying'
  | 'sibling_stop'
  | 'superseded'
  | 'terminal';

export type ConversationExecutionOutcome = {
  assistantMessageId?: string;
  error?: ConversationGenerationError;
  status: 'succeeded' | 'cancelled' | 'failed' | 'interrupted' | 'retrying';
};

export const getSupervisorTerminalOutcome = (outcome: ConversationExecutionOutcome) =>
  outcome.status === 'succeeded' || outcome.status === 'retrying' ? undefined : outcome;

const outcomeFromStopReason = (
  reason: ConversationGenerationStopReason,
): ConversationExecutionOutcome => {
  if (reason === 'sibling_stop') return { status: 'succeeded' };
  if (reason === 'cancelled' || reason === 'superseded') return { status: 'cancelled' };
  if (reason === 'retrying' || reason === 'terminal') return { status: 'retrying' };
  return { status: 'interrupted' };
};

const shouldStopGeneration = async (
  db: LobeChatDatabase,
  model: ConversationGenerationModel,
  operation: ConversationGenerationOperation,
  signal?: AbortSignal,
): Promise<ConversationGenerationStopReason | null> => {
  const current = await model.findById(operation.id);
  if (!current || !isActiveConversationGenerationStatus(current.status)) return 'terminal';
  if (current.attempt !== operation.attempt) return 'retrying';
  if (current.status === 'cancelling' || current.cancelRequestedAt) return 'cancelled';
  if (current.status !== 'processing') return 'retrying';

  if (operation.conversationVersion !== undefined && operation.conversationVersion !== null) {
    const currentVersion = await getConversationVersion(db, operation.userId);
    if (currentVersion !== operation.conversationVersion) return 'conversation_cleared';
  }
  if (
    await model.isSupersededByLaneGeneration({
      id: operation.id,
      lane: operation.lane,
      laneGeneration: operation.laneGeneration ?? 1,
    })
  ) {
    return 'superseded';
  }
  if (signal?.aborted) {
    const reason = signal.reason;
    if (reason === 'heartbeat_lost' || reason === 'retrying') return 'retrying';
    if (
      reason === 'cancelled' ||
      reason === 'conversation_cleared' ||
      reason === 'sibling_stop' ||
      reason === 'superseded' ||
      reason === 'terminal'
    ) {
      return reason;
    }
    return 'cancelled';
  }
  return null;
};

const finalizeIfStopped = async (
  model: ConversationGenerationModel,
  operation: ConversationGenerationOperation,
  reason: ConversationGenerationStopReason,
  db?: LobeChatDatabase,
) => {
  if (reason === 'terminal' || reason === 'retrying' || reason === 'sibling_stop') return;
  if (reason === 'conversation_cleared') {
    const error = {
      message: 'Conversation history was cleared before generation finished.',
      type: 'ConversationCleared',
    };
    const annotateMessageId = db
      ? await resolveLatestAssistantMessageId(db, operation)
      : operation.assistantMessageId;
    await finalize(model, operation, 'interrupted', error, db, annotateMessageId);
    return;
  }
  const error =
    reason === 'superseded'
      ? {
          message: 'Generation was replaced by a newer request.',
          type: 'Superseded',
        }
      : undefined;
  await finalize(model, operation, 'cancelled', error, db);
};

const finalizeUnlessStopped = async (
  db: LobeChatDatabase,
  model: ConversationGenerationModel,
  operation: ConversationGenerationOperation,
  signal?: AbortSignal,
  skipFinalize?: boolean,
) => {
  const stopReason = await shouldStopGeneration(db, model, operation, signal);
  if (stopReason) {
    if (!skipFinalize) await finalizeIfStopped(model, operation, stopReason, db);
    return stopReason;
  }
  if (!skipFinalize) await finalize(model, operation, 'succeeded', undefined, db);
  return null;
};

const loadScopedMessages = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  params: { groupId?: string; sessionId?: string; topicId?: string },
) => {
  const aiChat = new AiChatService(db, operation.userId);
  const { messages } = await aiChat.getMessagesAndTopics(params);
  return loadConversationThreadMessages(db, operation.userId, messages, operation.threadId);
};

const loadGeneralInstruction = async (db: LobeChatDatabase, userId: string) => {
  try {
    const state = await new UserModel(db, userId).getUserState(
      KeyVaultsGateKeeper.getUserKeyVaults,
    );
    return (state.settings?.general as { systemRole?: string } | undefined)?.systemRole;
  } catch {
    return undefined;
  }
};

const stopReasonError = (
  reason: ConversationGenerationStopReason,
): ConversationGenerationError | undefined => {
  if (reason === 'conversation_cleared') {
    return {
      message: 'Conversation history was cleared before generation finished.',
      type: 'ConversationCleared',
    };
  }
  if (reason === 'superseded') {
    return {
      message: 'Generation was replaced by a newer request.',
      type: 'Superseded',
    };
  }
  return undefined;
};

const finishChatStop = async (
  db: LobeChatDatabase,
  model: ConversationGenerationModel,
  operation: ConversationGenerationOperation,
  assistantId: string,
  stopReason: ConversationGenerationStopReason,
  skipFinalize?: boolean,
): Promise<ConversationExecutionOutcome> => {
  if (!skipFinalize) {
    await finalizeIfStopped(model, operation, stopReason, db);
    return { ...outcomeFromStopReason(stopReason), assistantMessageId: assistantId };
  }
  if (stopReason !== 'retrying' && stopReason !== 'terminal') {
    await clearUnfinishedPlaceholders(db, operation.userId, [assistantId]);
    const error = stopReasonError(stopReason);
    if (error && stopReason !== 'sibling_stop') {
      await annotateAssistantError(db, operation.userId, assistantId, error);
    }
  }
  return { ...outcomeFromStopReason(stopReason), assistantMessageId: assistantId };
};

const executeChat = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  options?: {
    onAssistantMessageId?: (id: string) => Promise<void>;
    runSignal?: AbortSignal;
    skipFinalize?: boolean;
  },
): Promise<ConversationExecutionOutcome> => {
  const model = new ConversationGenerationModel(db, operation.userId);
  const messageModel = new MessageModel(db, operation.userId);
  const version = await getConversationVersion(db, operation.userId);
  if (
    operation.conversationVersion !== undefined &&
    operation.conversationVersion !== null &&
    version !== operation.conversationVersion
  ) {
    const error = {
      message: 'Conversation history was cleared before generation finished.',
      type: 'ConversationCleared',
    };
    if (!options?.skipFinalize) await finalize(model, operation, 'interrupted', error, db, operation.assistantMessageId);
    else {
      await clearUnfinishedPlaceholders(db, operation.userId, [operation.assistantMessageId]);
      await annotateAssistantError(db, operation.userId, operation.assistantMessageId, error);
    }
    return { assistantMessageId: operation.assistantMessageId ?? undefined, error, status: 'interrupted' };
  }

  await updateOperation(model, operation, { phase: 'model' });
  await emit(model, operation, 'status', { phase: 'model', status: 'processing' });

  const messages = await loadScopedMessages(db, operation, {
    groupId: operation.groupId ?? undefined,
    sessionId: operation.sessionId ?? undefined,
    topicId: operation.topicId ?? undefined,
  });
  if (!operation.assistantMessageId) {
    throw new Error('Assistant message is missing for conversation generation');
  }
  let assistantId: string = operation.assistantMessageId;
  await ensureOwnedAssistantPlaceholder(db, operation, assistantId);

  const user = await UserModel.findById(db, operation.userId);
  const agent = operation.sessionId
    ? await new AgentModel(db, operation.userId).findBySessionId(operation.sessionId)
    : undefined;
  const runtimeState = await loadConversationRuntimeState(db, operation.userId);
  const runtimePayload = await resolveConversationRuntimePayload({
    db,
    fetchOnClient: operation.config.fetchOnClient,
    provider: operation.config.provider,
    userId: operation.userId,
  });
  const generalInstruction = await loadGeneralInstruction(db, operation.userId);
  let activatedSkillIds = [...(operation.config.activatedSkillIds || [])];

  let workingMessages = excludeOwnedAssistantMessages(messages, assistantId);
  if (operation.agentId) {
    workingMessages = filterMessagesForAgent(workingMessages, operation.agentId);
  }
  if (operation.config.ragQuery) {
    await updateOperation(model, operation, { phase: 'retrieving' });
    workingMessages = await injectRag(db, operation, workingMessages, agent);
  }

  const built = await buildConversationChatPayload({
    agentMemory: {
      dynamicMemory: agent?.assistantMemory || undefined,
      fixedMemory: agent?.fixedMemory || undefined,
    },
    config: {
      ...operation.config,
      activatedSkillIds,
      plugins: operation.config.plugins || agent?.plugins || undefined,
      systemRole: operation.config.systemRole || agent?.systemRole || undefined,
    },
    db,
    generalInstruction,
    historySummary: operation.config.historySummary,
    messages: workingMessages,
    profile: {
      email: user?.email,
      fullName: user?.fullName,
      nickname: user?.username,
      username: user?.username,
    },
    runtimeState,
    sessionId: operation.sessionId,
    userId: operation.userId,
  });

  const runtime = initModelRuntimeWithUserPayload(operation.config.provider, runtimePayload);
  const abortController = new AbortController();
  if (options?.runSignal?.aborted) {
    abortController.abort(options.runSignal.reason);
  } else {
    options?.runSignal?.addEventListener(
      'abort',
      () => abortController.abort(options.runSignal?.reason),
      { once: true },
    );
  }
  let lastFlush = Date.now();
  let lastChars = 0;
  let content = '';
  let reasoning: UIChatMessage['reasoning'] | undefined;

  const flush = async (force = false) => {
    if (
      !force &&
      Date.now() - lastFlush < CONVERSATION_GENERATION_CHECKPOINT_MS &&
      content.length - lastChars < CONVERSATION_GENERATION_CHECKPOINT_CHARS
    ) {
      return;
    }
    const stopReason = await shouldStopGeneration(db, model, operation, abortController.signal);
    if (stopReason) {
      abortController.abort(stopReason);
      throw new Error(`Conversation generation stopped: ${stopReason}`);
    }
    lastFlush = Date.now();
    lastChars = content.length;
    await messageModel.update(assistantId, {
      content: content || LOADING_FLAT,
      reasoning: reasoning ?? undefined,
    });
    await emit(model, operation, 'snapshot', {
      assistantMessageId: assistantId,
      content,
      phase: 'model',
      reasoning,
    });
  };

  const cancelWatcher = setInterval(() => {
    void shouldStopGeneration(db, model, operation, abortController.signal)
      .then((stopReason) => {
        if (stopReason) abortController.abort(stopReason);
      })
      .catch((error) => {
        console.warn('[conversation-generation] stop watcher failed', {
          error: error instanceof Error ? error.message : String(error),
          operationId: operation.id,
        });
      });
  }, 500);
  cancelWatcher.unref?.();

  try {
    let remainingTurns = CONVERSATION_GENERATION_MAX_TOOL_TURNS;
    let currentPayload = built.payload;
    let nextToolCache: ToolCacheDebugMetadata | undefined;
    let toolDiagnosticSequence = 0;

    for (;;) {
      const stopReason = await shouldStopGeneration(db, model, operation, abortController.signal);
      if (stopReason) {
        return finishChatStop(db, model, operation, assistantId, stopReason, options?.skipFinalize);
      }

      const currentAssistant = (await messageModel.findById(assistantId)) as UIChatMessage | undefined;
      const resumeAction = resolveChatResumeAction(currentAssistant);
      if (resumeAction === 'complete') break;

      let tools: ChatToolPayload[] = Array.isArray(currentAssistant?.tools)
        ? (currentAssistant.tools as ChatToolPayload[])
        : [];

      if (resumeAction === 'generate') {
        if (currentAssistant?.content && currentAssistant.content !== LOADING_FLAT) {
          content = '';
          reasoning = undefined;
          await messageModel.update(assistantId, { content: LOADING_FLAT, reasoning: undefined });
        }
        const response = await runtime.chat(
          currentPayload as any,
          createConversationRuntimeChatOptions({
            payload: currentPayload as ConversationRuntimeChatOptionsInput['payload'],
            provider: runtimePayload.runtimeProvider,
            sessionId: operation.sessionId,
            signal: abortController.signal,
            topicId: operation.topicId,
            toolCache: nextToolCache,
            userId: operation.userId,
          }),
        );
        const result = await consumeProtocolResponse(response, {
          onReasoning: async (_delta, next) => {
            reasoning = next;
            await flush();
          },
          onText: async (_delta, next) => {
            content = next;
            await flush();
          },
          signal: abortController.signal,
        });

        const postStreamStopReason = await shouldStopGeneration(
          db,
          model,
          operation,
          abortController.signal,
        );
        if (postStreamStopReason) {
          return finishChatStop(
            db,
            model,
            operation,
            assistantId,
            postStreamStopReason,
            options?.skipFinalize,
          );
        }

        if (result.error) {
          await messageModel.update(assistantId, {
            content: result.content || content,
            error: result.error as any,
            reasoning: result.reasoning ?? undefined,
          });
          if (!options?.skipFinalize) await finalize(model, operation, 'failed', result.error, db, assistantId);
          return { assistantMessageId: assistantId, error: result.error, status: 'failed' };
        }

        content = result.content;
        reasoning = result.reasoning;
        await flush(true);
        if (result.grounding || result.usage) {
          await messageModel.update(assistantId, {
            content,
            reasoning: reasoning ?? undefined,
            ...(result.grounding ? { search: result.grounding as any } : {}),
            ...(result.usage ? { metadata: { usage: result.usage } } : {}),
          });
        }

        if (!result.toolCalls?.length) {
          await messageModel.updateMetadata(assistantId, {
            [CONVERSATION_GENERATION_TURN_COMPLETE]: true,
          });
          break;
        }

        tools = result.toolCalls.map((item) => ({
          apiName: item.function?.name?.split('____')[1] || item.function?.name,
          arguments: item.function?.arguments,
          id: item.id,
          identifier: item.function?.name?.split('____')[0] || item.function?.name,
          type: 'default',
        })) as ChatToolPayload[];
        await messageModel.update(assistantId, {
          content,
          reasoning: reasoning ?? undefined,
          tools,
        });
      }

      if (!tools.length) break;

      await updateOperation(model, operation, { phase: 'tools' });
      await emit(model, operation, 'snapshot', {
        assistantMessageId: assistantId,
        phase: 'tools',
      });

      const assistantMessage = ((await messageModel.findById(assistantId)) || currentAssistant) as UIChatMessage;
      let shouldContinue = true;
      toolDiagnosticSequence += 1;
      const toolBatch = createConversationToolBatchCorrelation(
        tools.map((tool) => tool.id),
        toolDiagnosticSequence,
        operation.sessionId || operation.groupId,
      );
      reportConversationToolBatch(toolBatch, 'started');
      let toolResultCount = 0;
      let toolFailureCount = 0;
      try {
        for (const tool of tools) {
          const toolStopReason = await shouldStopGeneration(
            db,
            model,
            operation,
            abortController.signal,
          );
          if (toolStopReason) {
            return finishChatStop(
              db,
              model,
              operation,
              assistantId,
              toolStopReason,
              options?.skipFinalize,
            );
          }

          const isHttpMcp = await resolveConversationToolHttpMcp({
            db,
            payload: tool,
            userId: operation.userId,
          });
          let invocation: Awaited<ReturnType<typeof executeConversationToolStep>> | undefined;
          try {
            invocation = await executeConversationToolStep({
              assistantMessage: { ...assistantMessage, tools } as UIChatMessage,
              attempt: operation.attempt,
              db,
              operationId: operation.id,
              payload: tool,
              userId: operation.userId,
            });
            if (invocation.success) toolResultCount += 1;
            else toolFailureCount += 1;
            reportConversationToolCompletion({
              correlation: toolBatch,
              identifier: tool.identifier,
              isHttpMcp: invocation.isHttpMcp,
              outcome: invocation.success ? 'completed' : 'failed',
              toolCallId: tool.id,
            });
          } catch (error) {
            toolFailureCount += 1;
            reportConversationToolCompletion({
              correlation: toolBatch,
              identifier: tool.identifier,
              isHttpMcp,
              outcome: 'failed',
              toolCallId: tool.id,
            });
            throw error;
          }
          if (!invocation.messageId) {
            const existing = await messageModel.findToolMessageByCall(assistantId, tool.id);
            if (!existing) {
              await messageModel.create({
                content: invocation.content,
                groupId: operation.groupId ?? undefined,
                metadata: invocation.metadata,
                parentId: assistantId,
                plugin: tool,
                role: 'tool',
                sessionId: operation.sessionId ?? operation.groupId ?? '',
                threadId: operation.threadId ?? undefined,
                tool_call_id: tool.id,
                topicId: operation.topicId ?? undefined,
              });
            }
          }
          shouldContinue = shouldContinue && invocation.shouldContinue;
          const activated = (invocation.metadata?.skills as { activated?: string[] } | undefined)
            ?.activated;
          if (Array.isArray(activated)) {
            activatedSkillIds = [...new Set([...activatedSkillIds, ...activated])];
          }
        }
      } finally {
        const settledBatch = {
          ...toolBatch,
          failureCount: toolFailureCount,
          resultCount: toolResultCount,
        };
        reportConversationToolBatch(settledBatch, 'settled');
        nextToolCache = toConversationToolCacheMetadata(settledBatch);
      }

      if (!shouldCreateToolContinuation(remainingTurns, shouldContinue)) break;
      remainingTurns -= 1;

      const previousAssistantId = assistantId;
      const nextAssistantId = idGenerator('messages', 14);
      try {
        await createAssistantMessageAndAssign({
          assignment: options?.skipFinalize ? 'supervisorChild' : 'assistantMessageId',
          db,
          id: nextAssistantId,
          operation,
          params: {
            agentId: operation.agentId ?? undefined,
            content: LOADING_FLAT,
            fromModel: operation.config.model,
            fromProvider: operation.config.provider,
            groupId: operation.groupId ?? undefined,
            parentId: previousAssistantId,
            role: 'assistant',
            sessionId: operation.sessionId ?? operation.groupId ?? '',
            threadId: operation.threadId ?? undefined,
            topicId: operation.topicId ?? undefined,
          },
        });
        assistantId = nextAssistantId;
        operation.assistantMessageId = nextAssistantId;
        await options?.onAssistantMessageId?.(nextAssistantId);
      } catch (error) {
        await clearUnfinishedPlaceholders(db, operation.userId, [nextAssistantId]);
        if (!options?.skipFinalize) {
          try {
            await updateOperation(model, operation, { assistantMessageId: previousAssistantId });
            operation.assistantMessageId = previousAssistantId;
          } catch {
            // Ownership may already have moved off this attempt.
          }
        }
        throw error;
      }
      await emit(model, operation, 'snapshot', {
        assistantMessageId: assistantId,
        content: '',
        phase: 'model',
      });

      const latest = await loadScopedMessages(db, operation, {
        groupId: operation.groupId ?? undefined,
        sessionId: operation.sessionId ?? undefined,
        topicId: operation.topicId ?? undefined,
      });
      const continuedAgent = operation.sessionId
        ? await new AgentModel(db, operation.userId).findBySessionId(operation.sessionId)
        : agent;
      const continued = await buildConversationChatPayload({
        agentMemory: {
          dynamicMemory: continuedAgent?.assistantMemory || undefined,
          fixedMemory: continuedAgent?.fixedMemory || undefined,
        },
        config: {
          ...operation.config,
          activatedSkillIds,
          plugins: operation.config.plugins || agent?.plugins || undefined,
          systemRole: operation.config.systemRole || agent?.systemRole || undefined,
        },
        db,
        generalInstruction,
        messages: excludeOwnedAssistantMessages(latest, assistantId),
        runtimeState,
        sessionId: operation.sessionId,
        userId: operation.userId,
      });
      currentPayload = continued.payload;
      content = '';
      reasoning = undefined;
    }

    const latest = await messageModel.findById(assistantId);
    if (!latest) {
      throw new Error('Assistant message is missing after generation.');
    }
    if (latest.content === LOADING_FLAT) {
      await messageModel.update(assistantId, { content: content || '' });
    }

    if (operation.config.title?.topicId) {
      const titleStopReason = await shouldStopGeneration(
        db,
        model,
        operation,
        abortController.signal,
      );
      if (!titleStopReason) {
        await executeTitle(db, operation, {
          runSignal: abortController.signal,
          skipFinalize: true,
        });
      }
    }

    const finalStopReason = await shouldStopGeneration(
      db,
      model,
      operation,
      abortController.signal,
    );
    if (finalStopReason) {
      return finishChatStop(
        db,
        model,
        operation,
        assistantId,
        finalStopReason,
        options?.skipFinalize,
      );
    }

    if (!options?.skipFinalize) await finalize(model, operation, 'succeeded', undefined, db);
    return { assistantMessageId: assistantId, status: 'succeeded' };
  } finally {
    clearInterval(cancelWatcher);
  }
};

const injectRag = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  messages: UIChatMessage[],
  agent?: { files?: Array<{ enabled?: boolean | null; id?: string | null }> } | null,
) => {
  const query = operation.config.ragQuery;
  if (!query) return messages;
  const diagnosticId = isKnowledgeDebugEnabled() ? createKnowledgeDiagnosticId() : undefined;
  return runWithKnowledgeDebugOperation(
    {
      diagnosticId,
      operation: 'conversation_retrieval',
      runtime: 'worker',
      transport: 'graphile',
    },
    async () => {
      const startedAt = Date.now();
      const fileIds = (agent?.files || [])
        .filter((file) => file?.enabled && file.id)
        .map((file) => file.id as string);
      logKnowledgeDebugSafe('retrieval_started', {
        directFileCount: fileIds.length,
        knowledgeBaseCount: 0,
        phase: 'retrieval',
        queryCharacters: query.length,
        queryRewritten: false,
      });
      try {
        const resolved = await resolveRagEmbeddingConfig(db, operation.userId);
        if (!resolved.config || !resolved.fingerprint) return messages;
        const embeddings = await new RagEmbeddingService(resolved.config).embed(query, 'query');
        const { chunks, stats } = await new ChunkModel(db, operation.userId).semanticSearchForChatWithStats({
          embedding: embeddings[0],
          fileIds: fileIds.length > 0 ? fileIds : undefined,
          fingerprint: resolved.fingerprint,
          query,
        });
        logKnowledgeDebugSafe('vector_search_settled', {
          ...stats,
          outcome: 'completed',
          phase: 'vector_search',
        });
        logKnowledgeDebugSafe('retrieval_settled', {
          durationMs: Date.now() - startedAt,
          outcome: 'completed',
          phase: 'retrieval',
          selectedCount: stats.selectedCount,
        });
        if (!Array.isArray(chunks) || chunks.length === 0) return messages;
        const lastUser = [...messages].reverse().find((item) => item.role === 'user');
        if (!lastUser) return messages;
        const prompt = knowledgeBaseQAPrompts({
          chunks,
          userQuery: lastUser.content,
        });
        if (!prompt) return messages;
        logKnowledgeDebugSafe('prompt_injection_reported', {
          chunkCount: chunks.length,
          outcome: 'completed',
          phase: 'client_prompt_preparation',
        });
        return messages.map((item) =>
          item.id === lastUser.id ? { ...item, content: `${item.content}\n\n${prompt}`.trim() } : item,
        );
      } catch (error) {
        logKnowledgeDebugSafe('retrieval_settled', {
          ...describeKnowledgeDebugError(error),
          durationMs: Date.now() - startedAt,
          failurePhase: 'retrieval',
          outcome: 'failed',
          phase: 'retrieval',
        });
        return messages;
      }
    },
  );
};

const runSimpleCompletion = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
) => {
  const runtimePayload = await resolveConversationRuntimePayload({
    db,
    provider: operation.config.provider,
    userId: operation.userId,
  });
  const runtime = initModelRuntimeWithUserPayload(operation.config.provider, runtimePayload);
  const chatPayload = {
    ...payload,
    model: operation.config.model,
    stream: true,
  };
  const response = await runtime.chat(
    chatPayload as any,
    createConversationRuntimeChatOptions({
      payload: chatPayload,
      provider: runtimePayload.runtimeProvider,
      sessionId: operation.sessionId,
      signal,
      topicId: operation.topicId,
      userId: operation.userId,
    }),
  );
  const result = await consumeProtocolResponse(response);
  if (result.error) {
    const { message, type } = result.error;
    // When the stream resolver falls back to `provider: errorType`, the type is
    // already embedded in the message; appending it again would double-encode it
    // (e.g. `moonshot: ProviderBizError [ProviderBizError]`).
    const detail = type && !message.includes(type) ? ` [${type}]` : '';
    throw new Error(`${message}${detail}`);
  }
  return result.content.trim();
};

const executeTitle = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  options?: { runSignal?: AbortSignal; skipFinalize?: boolean },
) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  const topicId =
    operation.config.title?.topicId ||
    (operation.kind === 'topic_title' ? operation.topicId : undefined);
  if (!topicId) {
    await finalizeUnlessStopped(db, model, operation, options?.runSignal, options?.skipFinalize);
    return;
  }
  const topicModel = new TopicModel(db, operation.userId);
  const topic = await topicModel.findById(topicId);
  if (
    !shouldGenerateConversationTitle({
      force: operation.config.title?.force,
      isWelcomeQuestion: operation.config.isWelcomeQuestion,
      title: topic?.title,
    })
  ) {
    await finalizeUnlessStopped(db, model, operation, options?.runSignal, options?.skipFinalize);
    return;
  }
  const stopBefore = await shouldStopGeneration(db, model, operation, options?.runSignal);
  if (stopBefore) {
    if (!options?.skipFinalize) await finalizeIfStopped(model, operation, stopBefore, db);
    return;
  }
  await updateOperation(model, operation, { phase: 'title' });
  const messages = await loadScopedMessages(db, operation, {
    groupId: operation.groupId ?? undefined,
    sessionId: operation.sessionId ?? undefined,
    topicId,
  });
  // Without scoped messages (e.g. the title operation runs before messages are
  // bound to the topic) the summary prompt degrades to an empty user message,
  // which strict providers reject with a 400 ("content must not be empty").
  // Skip title generation instead of sending an invalid request.
  const hasTranscript = messages.some(
    (message) => typeof message.content === 'string' && message.content.trim().length > 0,
  );
  if (!hasTranscript) {
    await finalizeUnlessStopped(db, model, operation, options?.runSignal, options?.skipFinalize);
    return;
  }
  const payload = chainSummaryTitle(messages, operation.config.locale || 'en-US');
  const title = await runSimpleCompletion(db, operation, payload, options?.runSignal);
  const stopAfter = await shouldStopGeneration(db, model, operation, options?.runSignal);
  if (stopAfter) {
    if (!options?.skipFinalize) await finalizeIfStopped(model, operation, stopAfter, db);
    return;
  }
  if (title) {
    await topicModel.update(topicId, { title: title.slice(0, 120) });
    await emit(model, operation, 'snapshot', { title, topicId });
  }
  await finalizeUnlessStopped(db, model, operation, options?.runSignal, options?.skipFinalize);
};

const executeTranslation = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  options?: { runSignal?: AbortSignal },
) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  const translation = operation.config.translation;
  if (!translation) {
    await finalize(model, operation, 'failed', {
      message: 'Translation target is missing.',
      type: 'InvalidOperation',
    }, db);
    return;
  }
  await updateOperation(model, operation, { phase: 'translating' });
  const messageModel = new MessageModel(db, operation.userId);
  const message = await messageModel.findById(translation.messageId);
  if (!message?.content) {
    await finalize(model, operation, 'failed', {
      message: 'Source message was not found.',
      type: 'InvalidOperation',
    }, db);
    return;
  }
  const from =
    translation.from ||
    (await runSimpleCompletion(db, operation, chainLangDetect(message.content), options?.runSignal));
  const content = await runSimpleCompletion(
    db,
    operation,
    chainTranslate(message.content, translation.to),
    options?.runSignal,
  );
  const stopReason = await shouldStopGeneration(db, model, operation, options?.runSignal);
  if (stopReason) {
    await finalizeIfStopped(model, operation, stopReason, db);
    return;
  }
  await messageModel.updateTranslate(translation.messageId, {
    content,
    from,
    to: translation.to,
  });
  await emit(model, operation, 'snapshot', {
    messageId: translation.messageId,
    translate: { content, from, to: translation.to },
  });
  await finalizeUnlessStopped(db, model, operation, options?.runSignal);
};

const executeTts = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  options?: { runSignal?: AbortSignal },
) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  const tts = operation.config.tts;
  if (!tts) {
    await finalize(model, operation, 'failed', {
      message: 'TTS target is missing.',
      type: 'InvalidOperation',
    }, db);
    return;
  }
  await updateOperation(model, operation, { phase: 'synthesizing' });
  const messageModel = new MessageModel(db, operation.userId);
  await messageModel.updateTTS(tts.messageId, {
    contentMd5: tts.messageId,
    voice: tts.voice,
  });
  await emit(model, operation, 'snapshot', { messageId: tts.messageId, tts });
  await finalizeUnlessStopped(db, model, operation, options?.runSignal);
};

const executeCompaction = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  options?: { runSignal?: AbortSignal },
) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  const compaction = operation.config.compaction;
  if (!operation.topicId || operation.groupId || operation.threadId || !compaction) {
    await finalize(model, operation, 'interrupted', {
      message:
        'Background compaction requires a planned regular-topic snapshot; the client must re-plan it.',
      type: 'CompactionInvalidated',
    }, db);
    return;
  }
  await updateOperation(model, operation, { phase: 'compacting' });
  const aiChat = new AiChatService(db, operation.userId);
  const { messages } = await aiChat.getMessagesAndTopics({
    sessionId: operation.sessionId ?? undefined,
    topicId: operation.topicId,
  });
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const candidateMessages = compaction.candidateMessageIds
    .map((id) => messagesById.get(id))
    .filter(Boolean) as UIChatMessage[];
  const initialFingerprint = createCompactionFingerprint({
    cursorId: compaction.expectedCursorId,
    messages: candidateMessages,
    summary: compaction.expectedHistorySummary,
  });
  if (
    candidateMessages.length !== compaction.candidateMessageIds.length ||
    initialFingerprint !== compaction.expectedFingerprint
  ) {
    await finalize(model, operation, 'interrupted', {
      message: 'Compaction input changed before summarization started.',
      type: 'CompactionInvalidated',
    }, db);
    return;
  }

  let historySummary = operation.config.historySummary || '';
  for (const batch of splitCompactionBatches(candidateMessages)) {
    historySummary = await runSimpleCompletion(
      db,
      operation,
      {
        ...chainSummaryHistory(batch, historySummary || undefined),
        max_tokens: CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
        stream: false,
      },
      options?.runSignal,
    );
    if (!historySummary) {
      throw new Error('Memory compaction returned an empty summary.');
    }
  }

  const compactedThroughMessageId = candidateMessages.at(-1)!.id;
  const persisted = await withConversationWriteLockOrThrow(
    db,
    operation.userId,
    async (transaction) => {
      const topicModel = new TopicModel(transaction, operation.userId);
      const topic = await topicModel.findById(operation.topicId!);
      const metadata = (topic?.metadata || {}) as ChatTopicMetadata;
      if (
        !topic ||
        (topic.historySummary || '') !== compaction.expectedHistorySummary ||
        (metadata.historySummaryLastMessageId || undefined) !== compaction.expectedCursorId
      ) {
        return false;
      }

      const latestMessages = await new MessageModel(transaction, operation.userId).query({
        pageSize: 9999,
        sessionId: operation.sessionId,
        topicId: operation.topicId,
      });
      const latestById = new Map(latestMessages.map((message) => [message.id, message]));
      const latestCandidates = compaction.candidateMessageIds
        .map((id) => latestById.get(id))
        .filter(Boolean) as UIChatMessage[];
      const latestFingerprint = createCompactionFingerprint({
        cursorId: metadata.historySummaryLastMessageId,
        messages: latestCandidates,
        summary: topic.historySummary || undefined,
      });
      if (
        latestCandidates.length !== compaction.candidateMessageIds.length ||
        latestFingerprint !== compaction.expectedFingerprint
      ) {
        return false;
      }

      const status =
        compaction.trigger === 'token_threshold' && compaction.targetReachable === false
          ? 'target_unreachable'
          : 'compacted';
      const nextMetadata = buildConversationCompactionMetadata({
        compactedThroughMessageId,
        currentMetadata: metadata,
        messageCountIncluded: candidateMessages.length,
        model: operation.config.model,
        plan: compaction,
        provider: operation.config.provider,
        status,
        summary: historySummary,
      });
      await topicModel.update(operation.topicId!, {
        historySummary,
        metadata: nextMetadata,
      });
      return { metadata: nextMetadata, status };
    },
    operation.conversationVersion ?? undefined,
  );
  if (!persisted) {
    await finalize(model, operation, 'interrupted', {
      message: 'Compaction input was invalidated before the summary could be persisted.',
      type: 'CompactionInvalidated',
    }, db);
    return;
  }

  await emit(model, operation, 'snapshot', {
    historySummary,
    historySummaryLastMessageId: compactedThroughMessageId,
    metadata: persisted.metadata,
    status: persisted.status,
    topicId: operation.topicId,
  });
  await finalizeUnlessStopped(db, model, operation, options?.runSignal);
};

const executeRag = async (db: LobeChatDatabase, operation: ConversationGenerationOperation) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  await updateOperation(model, operation, { phase: 'retrieving' });
  await emit(model, operation, 'status', { phase: 'retrieving' });
  await finalize(model, operation, 'succeeded', undefined, db);
};

const parseJsonObject = (value?: string) => {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const normalizeSupervisorToolCalls = (
  value: unknown,
): Array<{ arguments: Record<string, unknown>; name: string }> => {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as { tool_calls?: unknown[] }).tool_calls)
  ) {
    parsed = (parsed as { tool_calls: unknown[] }).tool_calls;
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const name =
      typeof record.name === 'string'
        ? record.name
        : typeof record.tool_name === 'string'
          ? record.tool_name
          : undefined;
    if (!name) return [];
    const rawArguments = record.arguments ?? record.parameter;
    const arguments_ =
      typeof rawArguments === 'string'
        ? parseJsonObject(rawArguments)
        : rawArguments && typeof rawArguments === 'object'
          ? (rawArguments as Record<string, unknown>)
          : {};
    return [{ arguments: arguments_, name }];
  });
};

const executeSupervisor = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  options?: { runSignal?: AbortSignal },
) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  const groupId = operation.groupId;
  if (!groupId) {
    await finalize(model, operation, 'failed', {
      message: 'Group is missing for supervisor generation.',
      type: 'InvalidOperation',
    }, db);
    return;
  }

  const groupModel = new ChatGroupModel(db, operation.userId);
  const group = await groupModel.findById(groupId);
  const members = await groupModel.getEnabledGroupAgents(groupId);
  const agentModel = new AgentModel(db, operation.userId);
  const availableAgents = (
    await Promise.all(members.map((member) => agentModel.getAgentConfigById(member.agentId)))
  ).filter(Boolean) as Array<{
    id?: string | null;
    model?: string | null;
    plugins?: string[] | null;
    provider?: string | null;
    systemRole?: string | null;
    title?: string | null;
  }>;

  const messageModel = new MessageModel(db, operation.userId);
  const user = await UserModel.findById(db, operation.userId);
  const generalInstruction = await loadGeneralInstruction(db, operation.userId);
  const memberOrder = new Map(members.map((member) => [member.agentId, member.order ?? 0]));
  const availableAgentIds = availableAgents
    .filter((agent) => agent.id)
    .map((agent) => agent.id as string);
  const userName = user?.fullName || user?.username || 'User';
  const runtimePayload = await resolveConversationRuntimePayload({
    db,
    provider: operation.config.provider,
    userId: operation.userId,
  });
  const runtime = initModelRuntimeWithUserPayload(operation.config.provider, runtimePayload);

  const persistTodos = async (todos: ReturnType<typeof parseSupervisorTodosFromMessages>) => {
    await messageModel.create({
      content: formatSupervisorTodoContent(todos),
      fromModel: group?.config?.orchestratorModel || operation.config.model,
      fromProvider: group?.config?.orchestratorProvider || operation.config.provider,
      groupId,
      role: 'supervisor',
      sessionId: operation.sessionId ?? groupId,
      topicId: operation.topicId ?? undefined,
    });
    await emit(model, operation, 'snapshot', { phase: 'tools', todos });
  };

  const childMessageIds = [...(operation.config.supervisorChildMessageIds || [])];
  let persistChain = Promise.resolve();
  const appendChildId = (id: string) => {
    persistChain = persistChain.then(async () => {
      const updated = await model.appendSupervisorChildMessageId(operation.id, id, {
        attempt: operation.attempt,
        laneGeneration: operation.laneGeneration,
      });
      if (!updated) {
        throw new Error('Conversation generation attempt no longer owns the operation.');
      }
      operation.config = updated.config;
    });
    return persistChain;
  };
  const trackChild = async (id: string) => {
    if (childMessageIds.includes(id)) return;
    childMessageIds.push(id);
    await appendChildId(id);
  };

  await clearUnfinishedPlaceholders(db, operation.userId, childMessageIds);
  if (childMessageIds.length > 0) {
    childMessageIds.length = 0;
    await updateOperation(model, operation, {
      config: {
        ...operation.config,
        supervisorChildMessageIds: [],
      },
    });
  }

  const createChildAssistant = async (decision: {
    id: string;
    instruction?: string;
    target?: string;
  }) => {
    const agent = availableAgents.find((item) => item.id === decision.id);
    if (!agent?.id) return;
    const assistantId = idGenerator('messages', 14);
    try {
      const created = await createAssistantMessageAndAssign({
        assignment: 'supervisorChild',
        db,
        id: assistantId,
        operation,
        params: {
          agentId: agent.id,
          content: LOADING_FLAT,
          fromModel: agent.model || operation.config.model,
          fromProvider: agent.provider || operation.config.provider,
          groupId,
          role: 'assistant',
          sessionId: operation.sessionId ?? groupId,
          targetId: decision.target,
          topicId: operation.topicId ?? undefined,
        },
      });
      if (!childMessageIds.includes(assistantId)) childMessageIds.push(assistantId);
      await emit(model, operation, 'snapshot', {
        agentId: agent.id,
        assistantMessageId: created.id,
      });
      return { agent, assistantId: created.id, decision };
    } catch (error) {
      await clearUnfinishedPlaceholders(db, operation.userId, [assistantId]);
      throw error;
    }
  };

  const runAgentDecision = async (
    child: {
      agent: { id?: string | null; model?: string | null; plugins?: string[] | null; provider?: string | null; systemRole?: string | null; title?: string | null };
      assistantId: string;
      decision: { id: string; instruction?: string; target?: string };
    },
    history: UIChatMessage[],
    runSignal?: AbortSignal,
  ) => {
    const agentId = child.agent.id;
    if (!agentId) return { status: 'succeeded' } as ConversationExecutionOutcome;
    const groupChatSystemPrompt = buildGroupChatSystemPrompt({
      agentId,
      baseSystemRole: composeSystemRole(generalInstruction, child.agent.systemRole || undefined) || '',
      groupMembers: [
        { id: 'user', title: userName },
        ...availableAgents
          .filter((item) => item.id)
          .map((item) => ({ id: item.id as string, title: item.title || item.id || '' })),
      ],
      instruction: child.decision.instruction,
      messages: history,
      targetId: child.decision.target,
    });
    const childOperation: ConversationGenerationOperation = {
      ...operation,
      agentId,
      assistantMessageId: child.assistantId,
      config: {
        ...operation.config,
        model: child.agent.model || operation.config.model,
        plugins: child.agent.plugins || undefined,
        provider: child.agent.provider || operation.config.provider,
        systemRole: groupChatSystemPrompt,
        targetId: child.decision.target,
      },
      kind: 'group_agent',
    };
    try {
      const outcome = await executeChat(db, childOperation, {
        onAssistantMessageId: trackChild,
        runSignal: runSignal ?? options?.runSignal,
        skipFinalize: true,
      });
      if (outcome.assistantMessageId) child.assistantId = outcome.assistantMessageId;
      return outcome;
    } catch (error) {
      const stopReason = await shouldStopGeneration(
        db,
        model,
        operation,
        runSignal ?? options?.runSignal,
      );
      const latestAssistantId = childOperation.assistantMessageId || child.assistantId;
      child.assistantId = latestAssistantId;
      if (stopReason) {
        return finishChatStop(db, model, operation, latestAssistantId, stopReason, true);
      }
      const normalizedError = toError(error);
      await clearUnfinishedPlaceholders(db, operation.userId, [latestAssistantId]);
      await annotateAssistantError(db, operation.userId, latestAssistantId, normalizedError);
      return {
        assistantMessageId: latestAssistantId,
        error: normalizedError,
        status: 'failed' as const,
      };
    }
  };

  const applyChildOutcome = async (
    outcome: ConversationExecutionOutcome,
    child?: {
      assistantId: string;
      decision: { id: string };
    },
  ): Promise<boolean> => {
    if (outcome.status === 'retrying') {
      throw new Error('Conversation generation attempt lost ownership');
    }
    const terminalOutcome = getSupervisorTerminalOutcome(outcome);
    if (!terminalOutcome) return false;
    const error =
      terminalOutcome.status === 'failed'
        ? terminalOutcome.error || {
            message: child?.decision.id
              ? `Group agent "${child.decision.id}" failed.`
              : 'Group agent failed.',
            type: 'GroupAgentError',
          }
        : undefined;
    const failedAssistantId = outcome.assistantMessageId ?? child?.assistantId;
    await finalize(
      model,
      operation,
      terminalOutcome.status,
      error,
      db,
      error ? failedAssistantId : undefined,
      childMessageIds,
    );
    return true;
  };

  const runDecisions = async (
    decisions: Array<{ id: string; instruction?: string; target?: string }>,
  ) => {
    const children = [];
    for (const decision of decisions) {
      const stopReason = await shouldStopGeneration(db, model, operation, options?.runSignal);
      if (stopReason) {
        await finalizeIfStopped(model, operation, stopReason, db);
        return true;
      }
      const child = await createChildAssistant(decision);
      if (child) children.push(child);
    }
    if (children.length === 0) return false;

    if (group?.config?.responseOrder === 'sequential') {
      for (const child of children) {
        const stopReason = await shouldStopGeneration(db, model, operation, options?.runSignal);
        if (stopReason) {
          await finalizeIfStopped(model, operation, stopReason, db);
          return true;
        }
        const history = await loadScopedMessages(db, operation, {
          groupId,
          topicId: operation.topicId ?? undefined,
        });
        const outcome = await runAgentDecision(child, history);
        if (await applyChildOutcome(outcome, child)) return true;
      }
      return false;
    }

    const latestForAgents = await loadScopedMessages(db, operation, {
      groupId,
      topicId: operation.topicId ?? undefined,
    });
    const siblingControllers = children.map(() => new AbortController());
    const abortSiblings = (exceptIndex: number, reason: unknown) => {
      siblingControllers.forEach((controller, index) => {
        if (index !== exceptIndex && !controller.signal.aborted) {
          controller.abort(reason);
        }
      });
    };
    const onParentAbort = () => {
      siblingControllers.forEach((controller) => {
        if (!controller.signal.aborted) {
          controller.abort(options?.runSignal?.reason ?? 'cancelled');
        }
      });
    };
    options?.runSignal?.addEventListener('abort', onParentAbort);
    if (options?.runSignal?.aborted) onParentAbort();

    try {
      const settled = await Promise.allSettled(
        children.map(async (child, index) => {
          try {
            const outcome = await runAgentDecision(
              child,
              latestForAgents,
              siblingControllers[index]?.signal,
            );
            if (outcome.status === 'retrying' || getSupervisorTerminalOutcome(outcome)) {
              abortSiblings(index, outcome.status === 'retrying' ? 'retrying' : 'sibling_stop');
            }
            return outcome;
          } catch (error) {
            abortSiblings(index, 'sibling_stop');
            throw error;
          }
        }),
      );
      const outcomes = settled.map((result) => {
        if (result.status === 'fulfilled') return result.value;
        const normalizedError = toError(result.reason);
        return {
          error: normalizedError,
          status: 'failed' as const,
        };
      });
      if (outcomes.some((outcome) => outcome.status === 'retrying')) {
        throw new Error('Conversation generation attempt lost ownership');
      }
      for (const [index, outcome] of outcomes.entries()) {
        if (await applyChildOutcome(outcome, children[index])) return true;
      }
      return false;
    } finally {
      options?.runSignal?.removeEventListener('abort', onParentAbort);
    }
  };

  for (let round = 0; round < CONVERSATION_GENERATION_MAX_SUPERVISOR_ROUNDS; round += 1) {
    const stopBefore = await shouldStopGeneration(db, model, operation, options?.runSignal);
    if (stopBefore) {
      await finalizeIfStopped(model, operation, stopBefore, db);
      return;
    }

    const messages = await loadScopedMessages(db, operation, {
      groupId,
      topicId: operation.topicId ?? undefined,
    });
    if (round > 0 && shouldAvoidSupervisorDecision(messages, group?.config?.maxResponseInRow, false)) {
      break;
    }

    const todos = parseSupervisorTodosFromMessages(messages);
    const payload = contextSupervisorMakeDecision({
      allowDM: group?.config?.allowDM,
      availableAgents: availableAgents
        .filter((agent) => agent.id)
        .map((agent) => ({ id: agent.id as string, title: agent.title })),
      messages,
      scene: group?.config?.scene,
      systemPrompt: group?.config?.systemPrompt,
      todoList: todos,
      userName,
    });

    await updateOperation(model, operation, { phase: 'model' });
    const supervisorResponse = await runtime.generateObject(
      {
        ...payload,
        model: operation.config.model,
      } as any,
      {
        ...(options?.runSignal ? { signal: options.runSignal } : {}),
        user: operation.userId,
      },
    );

    const applied = applySupervisorToolCalls({
      allowDM: group?.config?.allowDM,
      availableAgentIds,
      previousTodos: todos,
      scene: group?.config?.scene,
      toolCalls: normalizeSupervisorToolCalls(supervisorResponse),
    });
    if (applied.todoUpdated) await persistTodos(applied.todos);

    const decisions =
      group?.config?.responseOrder === 'sequential'
        ? [...applied.decisions].sort(
            (left, right) => (memberOrder.get(left.id) ?? 0) - (memberOrder.get(right.id) ?? 0),
          )
        : applied.decisions;

    if (decisions.length === 0) {
      await finalizeUnlessStopped(db, model, operation, options?.runSignal);
      return;
    }

    if (await runDecisions(decisions)) return;
  }

  const current = await model.findById(operation.id);
  if (current && isActiveConversationGenerationStatus(current.status)) {
    await finalizeUnlessStopped(db, model, operation, options?.runSignal);
  }
};
