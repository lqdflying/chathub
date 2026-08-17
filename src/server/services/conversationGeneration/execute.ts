import { LOADING_FLAT } from '@lobechat/const';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
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
  ConversationGenerationError,
  ConversationGenerationOperation,
  UIChatMessage,
} from '@lobechat/types';
import { isActiveConversationGenerationStatus } from '@lobechat/types';
import type { LobeChatDatabase } from '@lobechat/database';
import {
  ConversationWriteRejectedError,
  getConversationVersion,
} from '@/server/services/conversationWriteLock';
import { composeSystemRole } from '@/services/chat/composeSystemRole';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { ConversationGenerationModel } from '@/database/models/conversationGeneration';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { ChunkModel } from '@/database/models/chunk';
import { AiChatService } from '@/server/services/aiChat';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  RagEmbeddingService,
  resolveRagEmbeddingConfig,
} from '@/server/services/rag/embedding';

import {
  CONVERSATION_GENERATION_CHECKPOINT_CHARS,
  CONVERSATION_GENERATION_CHECKPOINT_MS,
  CONVERSATION_GENERATION_HEARTBEAT_MS,
  CONVERSATION_GENERATION_MAX_ATTEMPTS,
} from './constants';
import {
  loadConversationRuntimeState,
  resolveConversationRuntimePayload,
} from './credentials';
import { buildConversationChatPayload } from './payload';
import { consumeProtocolResponse } from './stream';
import { invokeConversationTool } from './tools';

const MAX_TOOL_TURNS = 8;

const toError = (error: unknown): ConversationGenerationError => ({
  body: error instanceof Error ? { name: error.name } : error,
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
    await finalize(model, operation, 'cancelled');
    return;
  }

  const claimed = await model.claimForProcessing(operationId);
  if (!claimed) return;

  if (
    await model.isSupersededByLaneGeneration({
      id: claimed.id,
      lane: claimed.lane,
      laneGeneration: claimed.laneGeneration ?? 1,
    })
  ) {
    await finalizeIfStopped(model, claimed, 'superseded');
    return;
  }

  const heartbeatTimer = setInterval(() => {
    void model.touchHeartbeat(claimed.id, claimed.attempt).catch((error) => {
      console.warn('[conversation-generation] heartbeat failed', {
        error: error instanceof Error ? error.message : String(error),
        operationId: claimed.id,
      });
    });
  }, CONVERSATION_GENERATION_HEARTBEAT_MS);
  heartbeatTimer.unref?.();

  try {
    switch (claimed.kind) {
      case 'topic_title': {
        await executeTitle(db, claimed);
        break;
      }
      case 'translation': {
        await executeTranslation(db, claimed);
        break;
      }
      case 'tts': {
        await executeTts(db, claimed);
        break;
      }
      case 'memory_compaction': {
        await executeCompaction(db, claimed);
        break;
      }
      case 'rag': {
        await executeRag(db, claimed);
        break;
      }
      case 'group_supervisor': {
        await executeSupervisor(db, claimed);
        break;
      }
      default: {
        await executeChat(db, claimed);
      }
    }
  } catch (error) {
    const stopReason = await shouldStopGeneration(db, model, claimed);
    if (stopReason) {
      await finalizeIfStopped(model, claimed, stopReason);
      if (stopReason === 'retrying') throw error;
      return;
    }

    const normalizedError = toError(error);
    if (error instanceof ConversationWriteRejectedError) {
      await finalize(model, claimed, 'interrupted', normalizedError);
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

    await finalize(model, claimed, 'failed', normalizedError);
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
) => {
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
  | 'superseded'
  | 'terminal';

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

  if (
    operation.conversationVersion !== undefined &&
    operation.conversationVersion !== null
  ) {
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
  if (signal?.aborted) return 'cancelled';
  return null;
};

const finalizeIfStopped = async (
  model: ConversationGenerationModel,
  operation: ConversationGenerationOperation,
  reason: ConversationGenerationStopReason,
) => {
  if (reason === 'terminal' || reason === 'retrying') return;
  if (reason === 'conversation_cleared') {
    await finalize(model, operation, 'interrupted', {
      message: 'Conversation history was cleared before generation finished.',
      type: 'ConversationCleared',
    });
    return;
  }
  await finalize(
    model,
    operation,
    'cancelled',
    reason === 'superseded'
      ? {
          message: 'Generation was replaced by a newer request.',
          type: 'Superseded',
        }
      : undefined,
  );
};

const loadGeneralInstruction = async (db: LobeChatDatabase, userId: string) => {
  try {
    const state = await new UserModel(db, userId).getUserState(KeyVaultsGateKeeper.getUserKeyVaults);
    return (state.settings?.general as { systemRole?: string } | undefined)?.systemRole;
  } catch {
    return undefined;
  }
};

const executeChat = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  options?: { skipFinalize?: boolean },
) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  const messageModel = new MessageModel(db, operation.userId);
  const aiChat = new AiChatService(db, operation.userId);
  const version = await getConversationVersion(db, operation.userId);
  if (
    operation.conversationVersion !== undefined &&
    operation.conversationVersion !== null &&
    version !== operation.conversationVersion
  ) {
    await finalize(model, operation, 'interrupted', {
      message: 'Conversation history was cleared before generation finished.',
      type: 'ConversationCleared',
    });
    return;
  }

  await updateOperation(model, operation, { phase: 'model' });
  await emit(model, operation, 'status', { phase: 'model', status: 'processing' });

  const { messages } = await aiChat.getMessagesAndTopics({
    groupId: operation.groupId ?? undefined,
    sessionId: operation.sessionId ?? undefined,
    topicId: operation.topicId ?? undefined,
  });
  if (!operation.assistantMessageId) {
    throw new Error('Assistant message is missing for conversation generation');
  }
  let assistantId: string = operation.assistantMessageId;

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

  let workingMessages = messages.filter(
    (item) => item.id !== assistantId || item.content !== LOADING_FLAT,
  );
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
    let remainingTurns = MAX_TOOL_TURNS;
    let currentPayload = built.payload;

    while (remainingTurns >= 0) {
      const stopReason = await shouldStopGeneration(
        db,
        model,
        operation,
        abortController.signal,
      );
      if (stopReason) {
        await finalizeIfStopped(model, operation, stopReason);
        return;
      }

      const response = await runtime.chat(currentPayload as any, {
        signal: abortController.signal,
        user: operation.userId,
      });
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
        await finalizeIfStopped(model, operation, postStreamStopReason);
        return;
      }

      if (result.error) {
        await messageModel.update(assistantId, {
          content: result.content || content,
          error: result.error as any,
          reasoning: result.reasoning ?? undefined,
        });
        await finalize(model, operation, 'failed', result.error);
        return;
      }

      content = result.content;
      reasoning = result.reasoning;
      await flush(true);

      if (!result.toolCalls?.length) break;

      await updateOperation(model, operation, { phase: 'tools' });
      const tools = result.toolCalls.map((item) => ({
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

      const assistantMessage = (await messageModel.findById(assistantId)) as UIChatMessage;
      for (const tool of tools) {
        const toolStopReason = await shouldStopGeneration(
          db,
          model,
          operation,
          abortController.signal,
        );
        if (toolStopReason) {
          await finalizeIfStopped(model, operation, toolStopReason);
          return;
        }

        const invocation = await invokeConversationTool({
          assistantMessage: { ...assistantMessage, tools } as UIChatMessage,
          db,
          payload: tool,
          userId: operation.userId,
        });
        if (!invocation.messageId) {
          await messageModel.create({
            content: invocation.content,
            groupId: operation.groupId ?? undefined,
            parentId: assistantId,
            plugin: tool,
            role: 'tool',
            sessionId: operation.sessionId ?? operation.groupId ?? '',
            threadId: operation.threadId ?? undefined,
            tool_call_id: tool.id,
            topicId: operation.topicId ?? undefined,
          });
        }
        if (!invocation.success) {
          await finalize(model, operation, 'failed', {
            message: invocation.content,
            type: 'ToolExecutionError',
          });
          return;
        }
      }

      const nextAssistant = await messageModel.create({
        agentId: operation.agentId ?? undefined,
        content: LOADING_FLAT,
        fromModel: operation.config.model,
        fromProvider: operation.config.provider,
        groupId: operation.groupId ?? undefined,
        parentId: assistantId,
        role: 'assistant',
        sessionId: operation.sessionId ?? operation.groupId ?? '',
        threadId: operation.threadId ?? undefined,
        topicId: operation.topicId ?? undefined,
      });
      assistantId = nextAssistant.id;
      await updateOperation(model, operation, { assistantMessageId: assistantId });
      await emit(model, operation, 'snapshot', {
        assistantMessageId: assistantId,
        content: '',
        phase: 'model',
      });

      const { messages: latest } = await aiChat.getMessagesAndTopics({
        groupId: operation.groupId ?? undefined,
        sessionId: operation.sessionId ?? undefined,
        topicId: operation.topicId ?? undefined,
      });
      const continued = await buildConversationChatPayload({
        agentMemory: {
          dynamicMemory: agent?.assistantMemory || undefined,
          fixedMemory: agent?.fixedMemory || undefined,
        },
        config: {
          ...operation.config,
          plugins: operation.config.plugins || agent?.plugins || undefined,
          systemRole: operation.config.systemRole || agent?.systemRole || undefined,
        },
        db,
        generalInstruction,
        messages: latest,
        runtimeState,
        sessionId: operation.sessionId,
        userId: operation.userId,
      });
      currentPayload = continued.payload;
      remainingTurns -= 1;
      content = '';
      reasoning = undefined;
    }

    const latest = await messageModel.findById(assistantId);
    if (latest?.content === LOADING_FLAT) {
      await messageModel.update(assistantId, { content: content || '' });
    }

    if (operation.config.title?.topicId || operation.topicId) {
      await executeTitle(db, operation, { skipFinalize: true });
    }

    const finalStopReason = await shouldStopGeneration(
      db,
      model,
      operation,
      abortController.signal,
    );
    if (finalStopReason) {
      await finalizeIfStopped(model, operation, finalStopReason);
      return;
    }

    if (!options?.skipFinalize) await finalize(model, operation, 'succeeded');
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
  try {
    const resolved = await resolveRagEmbeddingConfig(db, operation.userId);
    if (!resolved.config || !resolved.fingerprint) return messages;
    const embeddings = await new RagEmbeddingService(resolved.config).embed(query, 'query');
    const fileIds = (agent?.files || [])
      .filter((file) => file?.enabled && file.id)
      .map((file) => file.id as string);
    const chunks = await new ChunkModel(db, operation.userId).semanticSearchForChat({
      embedding: embeddings[0],
      fileIds: fileIds.length > 0 ? fileIds : undefined,
      fingerprint: resolved.fingerprint,
      query,
    });
    if (!Array.isArray(chunks) || chunks.length === 0) return messages;
    const lastUser = [...messages].reverse().find((item) => item.role === 'user');
    if (!lastUser) return messages;
    const prompt = knowledgeBaseQAPrompts({
      chunks,
      userQuery: lastUser.content,
    });
    if (!prompt) return messages;
    return messages.map((item) =>
      item.id === lastUser.id ? { ...item, content: `${item.content}\n\n${prompt}`.trim() } : item,
    );
  } catch {
    return messages;
  }
};

const runSimpleCompletion = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  payload: Record<string, unknown>,
) => {
  const runtimePayload = await resolveConversationRuntimePayload({
    db,
    provider: operation.config.provider,
    userId: operation.userId,
  });
  const runtime = initModelRuntimeWithUserPayload(operation.config.provider, runtimePayload);
  const response = await runtime.chat({
    ...payload,
    model: operation.config.model,
    stream: true,
  } as any);
  const result = await consumeProtocolResponse(response);
  if (result.error) throw new Error(result.error.message);
  return result.content.trim();
};

const executeTitle = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  options?: { skipFinalize?: boolean },
) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  const topicId = operation.config.title?.topicId || operation.topicId;
  if (!topicId) {
    if (!options?.skipFinalize) await finalize(model, operation, 'succeeded');
    return;
  }
  await updateOperation(model, operation, { phase: 'title' });
  const aiChat = new AiChatService(db, operation.userId);
  const { messages } = await aiChat.getMessagesAndTopics({
    groupId: operation.groupId ?? undefined,
    sessionId: operation.sessionId ?? undefined,
    topicId,
  });
  const payload = chainSummaryTitle(messages, 'en-US');
  const title = await runSimpleCompletion(db, operation, payload);
  if (title) {
    await new TopicModel(db, operation.userId).update(topicId, { title: title.slice(0, 120) });
    await emit(model, operation, 'snapshot', { title, topicId });
  }
  if (!options?.skipFinalize) await finalize(model, operation, 'succeeded');
};

const executeTranslation = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  const translation = operation.config.translation;
  if (!translation) {
    await finalize(model, operation, 'failed', {
      message: 'Translation target is missing.',
      type: 'InvalidOperation',
    });
    return;
  }
  await updateOperation(model, operation, { phase: 'translating' });
  const messageModel = new MessageModel(db, operation.userId);
  const message = await messageModel.findById(translation.messageId);
  if (!message?.content) {
    await finalize(model, operation, 'failed', {
      message: 'Source message was not found.',
      type: 'InvalidOperation',
    });
    return;
  }
  const from =
    translation.from ||
    (await runSimpleCompletion(db, operation, chainLangDetect(message.content)));
  const content = await runSimpleCompletion(
    db,
    operation,
    chainTranslate(message.content, translation.to),
  );
  await messageModel.updateTranslate(translation.messageId, {
    content,
    from,
    to: translation.to,
  });
  await emit(model, operation, 'snapshot', {
    messageId: translation.messageId,
    translate: { content, from, to: translation.to },
  });
  await finalize(model, operation, 'succeeded');
};

const executeTts = async (db: LobeChatDatabase, operation: ConversationGenerationOperation) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  const tts = operation.config.tts;
  if (!tts) {
    await finalize(model, operation, 'failed', {
      message: 'TTS target is missing.',
      type: 'InvalidOperation',
    });
    return;
  }
  await updateOperation(model, operation, { phase: 'synthesizing' });
  const messageModel = new MessageModel(db, operation.userId);
  await messageModel.updateTTS(tts.messageId, {
    contentMd5: tts.messageId,
    voice: tts.voice,
  });
  await emit(model, operation, 'snapshot', { messageId: tts.messageId, tts });
  await finalize(model, operation, 'succeeded');
};

const executeCompaction = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  if (!operation.topicId) {
    await finalize(model, operation, 'succeeded');
    return;
  }
  await updateOperation(model, operation, { phase: 'compacting' });
  const aiChat = new AiChatService(db, operation.userId);
  const { messages } = await aiChat.getMessagesAndTopics({
    groupId: operation.groupId ?? undefined,
    sessionId: operation.sessionId ?? undefined,
    topicId: operation.topicId,
  });
  const topic = await new TopicModel(db, operation.userId).findById(operation.topicId);
  const payload = chainSummaryHistory(messages, topic?.historySummary || undefined);
  const summary = await runSimpleCompletion(db, operation, payload);
  if (summary) {
    await new TopicModel(db, operation.userId).update(operation.topicId, {
      historySummary: summary,
    });
    await emit(model, operation, 'snapshot', { historySummary: summary, topicId: operation.topicId });
  }
  await finalize(model, operation, 'succeeded');
};

const executeRag = async (db: LobeChatDatabase, operation: ConversationGenerationOperation) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  await updateOperation(model, operation, { phase: 'retrieving' });
  await emit(model, operation, 'status', { phase: 'retrieving' });
  await finalize(model, operation, 'succeeded');
};

const parseJsonObject = (value?: string) => {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const executeSupervisor = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
) => {
  const model = new ConversationGenerationModel(db, operation.userId);
  const groupId = operation.groupId;
  if (!groupId) {
    await finalize(model, operation, 'failed', {
      message: 'Group is missing for supervisor generation.',
      type: 'InvalidOperation',
    });
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

  const aiChat = new AiChatService(db, operation.userId);
  const { messages } = await aiChat.getMessagesAndTopics({
    groupId,
    topicId: operation.topicId ?? undefined,
  });
  const payload = contextSupervisorMakeDecision({
    allowDM: group?.config?.allowDM,
    availableAgents: availableAgents
      .filter((agent) => agent.id)
      .map((agent) => ({ id: agent.id as string, title: agent.title })),
    messages,
    scene: group?.config?.scene,
    systemPrompt: group?.config?.systemPrompt,
  });

  await updateOperation(model, operation, { phase: 'model' });
  const runtimePayload = await resolveConversationRuntimePayload({
    db,
    provider: operation.config.provider,
    userId: operation.userId,
  });
  const runtime = initModelRuntimeWithUserPayload(operation.config.provider, runtimePayload);
  const response = await runtime.chat({
    ...payload,
    model: operation.config.model,
    stream: true,
  } as any);
  const result = await consumeProtocolResponse(response);
  if (result.error) {
    await finalize(model, operation, 'failed', result.error);
    return;
  }

  const decisions: Array<{ id: string; instruction?: string; target?: string }> = [];
  for (const call of result.toolCalls || []) {
    const name = call.function?.name;
    const args = parseJsonObject(call.function?.arguments);
    if (name === 'trigger_agent' || name === 'trigger_agent_dm') {
      const id = typeof args.id === 'string' ? args.id : undefined;
      if (!id) continue;
      decisions.push({
        id,
        instruction: typeof args.instruction === 'string' ? args.instruction : undefined,
        target: name === 'trigger_agent_dm' ? 'user' : undefined,
      });
    }
  }

  if (decisions.length === 0) {
    await finalize(model, operation, 'succeeded');
    return;
  }

  const messageModel = new MessageModel(db, operation.userId);
  const user = await UserModel.findById(db, operation.userId);
  const generalInstruction = await loadGeneralInstruction(db, operation.userId);

  for (const decision of decisions) {
    const stopReason = await shouldStopGeneration(db, model, operation);
    if (stopReason) {
      await finalizeIfStopped(model, operation, stopReason);
      return;
    }
    const agent = availableAgents.find((item) => item.id === decision.id);
    if (!agent?.id) continue;

    const groupChatSystemPrompt = buildGroupChatSystemPrompt({
      agentId: agent.id,
      baseSystemRole: composeSystemRole(generalInstruction, agent.systemRole || undefined) || '',
      groupMembers: [
        { id: 'user', title: user?.fullName || user?.username || 'User' },
        ...availableAgents
          .filter((item) => item.id)
          .map((item) => ({ id: item.id as string, title: item.title || item.id || '' })),
      ],
      instruction: decision.instruction,
      messages,
      targetId: decision.target,
    });

    const created = await messageModel.create({
      agentId: agent.id,
      content: LOADING_FLAT,
      fromModel: agent.model || operation.config.model,
      fromProvider: agent.provider || operation.config.provider,
      groupId,
      role: 'assistant',
      sessionId: operation.sessionId ?? groupId,
      targetId: decision.target,
      topicId: operation.topicId ?? undefined,
    });
    await emit(model, operation, 'snapshot', {
      agentId: agent.id,
      assistantMessageId: created.id,
    });
    await executeChat(
      db,
      {
        ...operation,
        agentId: agent.id,
        assistantMessageId: created.id,
        config: {
          ...operation.config,
          model: agent.model || operation.config.model,
          plugins: agent.plugins || undefined,
          provider: agent.provider || operation.config.provider,
          systemRole: groupChatSystemPrompt,
          targetId: decision.target,
        },
        kind: 'group_agent',
      },
      { skipFinalize: true },
    );
  }

  await finalize(model, operation, 'succeeded');
};
