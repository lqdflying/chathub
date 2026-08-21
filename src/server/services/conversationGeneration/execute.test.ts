/** @vitest-environment node */
import { LOADING_FLAT } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';
import {
  ConversationWriteRejectedError,
  getConversationVersion,
  withConversationWriteLockOrThrow,
} from '@/server/services/conversationWriteLock';

import { titleTranscriptRetryDelayMs } from './constants';
import {
  CONVERSATION_GENERATION_TURN_COMPLETE,
  excludeOwnedAssistantMessages,
  executeConversationGeneration,
  getSupervisorTerminalOutcome,
  resolveChatResumeAction,
  shouldCreateToolContinuation,
  shouldGenerateConversationTitle,
} from './execute';
import { buildConversationChatPayload } from './payload';
import { consumeProtocolResponse } from './stream';
import * as toolDiagnostics from './toolDiagnostics';
import { executeConversationToolStep, resolveConversationToolHttpMcp } from './tools';

const modelMocks = vi.hoisted(() => ({
  appendSupervisorChildMessageId: vi.fn(),
  bumpRevision: vi.fn(),
  claimForProcessing: vi.fn(),
  create: vi.fn(),
  finalizeActive: vi.fn(),
  findActiveByLane: vi.fn(),
  findById: vi.fn(),
  findByIdempotencyKey: vi.fn(),
  findMaxLaneGeneration: vi.fn(),
  insertEvent: vi.fn(),
  isSupersededByLaneGeneration: vi.fn(),
  markForRetry: vi.fn(),
  markPlaceholdersCleaned: vi.fn(),
  touchHeartbeat: vi.fn(),
  update: vi.fn(),
}));

const messageMocks = vi.hoisted(() => ({
  create: vi.fn(),
  findById: vi.fn(),
  findToolMessageByCall: vi.fn(),
  update: vi.fn(),
  updateMetadata: vi.fn(),
}));

const agentMocks = vi.hoisted(() => ({
  findBySessionId: vi.fn(),
  getAgentConfigById: vi.fn(),
}));

const chatGroupMocks = vi.hoisted(() => ({
  findById: vi.fn(),
  getEnabledGroupAgents: vi.fn(),
}));

const aiChatMocks = vi.hoisted(() => ({
  getMessagesAndTopics: vi.fn(),
}));

const topicMocks = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
}));

const runtimeMocks = vi.hoisted(() => ({
  chat: vi.fn(),
  generateObject: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  enqueueConversationGenerationJob: vi.fn(),
  enqueueInTransaction: vi.fn(),
}));
const generationDebugMocks = vi.hoisted(() => ({
  hashGenerationDebugValue: vi.fn((value: string) => `hash:${value}`),
  logGenerationDebugSafe: vi.fn(),
}));

vi.mock('@/libs/logger/generationDebug', () => ({
  hashGenerationDebugValue: generationDebugMocks.hashGenerationDebugValue,
  logGenerationDebugSafe: generationDebugMocks.logGenerationDebugSafe,
}));
vi.mock('./service', () => ({
  ConversationGenerationService: class {
    enqueue = serviceMocks.enqueue;
    enqueueInTransaction = serviceMocks.enqueueInTransaction;
  },
  enqueueConversationGenerationJob: serviceMocks.enqueueConversationGenerationJob,
}));

vi.mock('@/database/models/conversationGeneration', () => ({
  ConversationGenerationModel: class {
    appendSupervisorChildMessageId = modelMocks.appendSupervisorChildMessageId;
    bumpRevision = modelMocks.bumpRevision;
    claimForProcessing = modelMocks.claimForProcessing;
    create = modelMocks.create;
    finalizeActive = modelMocks.finalizeActive;
    findActiveByLane = modelMocks.findActiveByLane;
    findById = modelMocks.findById;
    findByIdempotencyKey = modelMocks.findByIdempotencyKey;
    findMaxLaneGeneration = modelMocks.findMaxLaneGeneration;
    insertEvent = modelMocks.insertEvent;
    isSupersededByLaneGeneration = modelMocks.isSupersededByLaneGeneration;
    markForRetry = modelMocks.markForRetry;
    markPlaceholdersCleaned = modelMocks.markPlaceholdersCleaned;
    touchHeartbeat = modelMocks.touchHeartbeat;
    update = modelMocks.update;
  },
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    findBySessionId = agentMocks.findBySessionId;
    getAgentConfigById = agentMocks.getAgentConfigById;
  },
}));
vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: class {
    findById = chatGroupMocks.findById;
    getEnabledGroupAgents = chatGroupMocks.getEnabledGroupAgents;
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    create = messageMocks.create;
    findById = messageMocks.findById;
    findToolMessageByCall = messageMocks.findToolMessageByCall;
    update = messageMocks.update;
    updateMetadata = messageMocks.updateMetadata;
  },
}));
vi.mock('@/database/models/thread', () => ({
  ThreadModel: class {
    findById = vi.fn();
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = topicMocks.findById;
    update = topicMocks.update;
  },
}));
vi.mock('@/database/models/user', () => ({ UserModel: { findById: vi.fn() } }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: class {} }));
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: class {
    getMessagesAndTopics = aiChatMocks.getMessagesAndTopics;
  },
}));
vi.mock('@/server/services/conversationWriteLock', () => ({
  ConversationWriteRejectedError: class extends Error {
    constructor() {
      super('Conversation write was rejected because conversation history was cleared.');
      this.name = 'ConversationWriteRejectedError';
    }
  },
  getConversationVersion: vi.fn().mockResolvedValue(1),
  withConversationWriteLockOrThrow: vi.fn(),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeWithUserPayload: vi.fn(() => ({
    chat: runtimeMocks.chat,
    generateObject: runtimeMocks.generateObject,
  })),
}));
vi.mock('./credentials', () => ({
  loadConversationRuntimeState: vi.fn().mockResolvedValue({}),
  resolveConversationRuntimePayload: vi.fn().mockResolvedValue({ runtimeProvider: 'openai' }),
}));
vi.mock('./payload', () => ({
  buildConversationChatPayload: vi.fn().mockResolvedValue({ payload: { messages: [] } }),
}));
vi.mock('./stream', () => ({
  consumeProtocolResponse: vi.fn(),
}));
vi.mock('./tools', () => ({
  executeConversationToolStep: vi.fn(),
  resolveConversationToolHttpMcp: vi.fn().mockResolvedValue(false),
}));

describe('conversation generation workflow guards', () => {
  it('stops before creating a placeholder when the tool-turn budget is exhausted', () => {
    expect(shouldCreateToolContinuation(0, true)).toBe(false);
    expect(shouldCreateToolContinuation(1, true)).toBe(true);
    expect(shouldCreateToolContinuation(8, false)).toBe(false);
  });

  it('only generates titles for explicit, welcome-safe new or untitled topics', () => {
    expect(shouldGenerateConversationTitle({ title: '' })).toBe(true);
    expect(shouldGenerateConversationTitle({ title: 'Existing title' })).toBe(false);
    expect(
      shouldGenerateConversationTitle({ force: true, title: 'Temporary new-topic title' }),
    ).toBe(true);
    expect(
      shouldGenerateConversationTitle({ force: true, isWelcomeQuestion: true, title: '' }),
    ).toBe(false);
  });

  it('propagates a nested group-agent terminal outcome instead of reporting supervisor success', () => {
    expect(
      getSupervisorTerminalOutcome({
        error: { message: 'agent failed', type: 'GroupAgentError' },
        status: 'failed',
      }),
    ).toMatchObject({ status: 'failed' });
    expect(getSupervisorTerminalOutcome({ status: 'cancelled' })).toMatchObject({
      status: 'cancelled',
    });
    expect(getSupervisorTerminalOutcome({ status: 'succeeded' })).toBeUndefined();
    expect(getSupervisorTerminalOutcome({ status: 'retrying' })).toBeUndefined();
  });

  it('excludes the owned assistant from model history', () => {
    expect(
      excludeOwnedAssistantMessages(
        [
          { content: 'hi', id: 'user-1', role: 'user' },
          { content: '...', id: 'assistant-1', role: 'assistant' },
        ] as any,
        'assistant-1',
      ).map((item) => item.id),
    ).toEqual(['user-1']);
  });

  it('resumes a tool-bearing assistant instead of calling the model on that row', () => {
    expect(resolveChatResumeAction({ content: 'done', tools: [{ id: 'call-1' }] })).toBe(
      'continue-tools',
    );
    expect(resolveChatResumeAction({ content: 'checkpointed partial', tools: [] })).toBe(
      'generate',
    );
    expect(
      resolveChatResumeAction({
        content: 'final answer',
        metadata: { [CONVERSATION_GENERATION_TURN_COMPLETE]: true },
        tools: [],
      }),
    ).toBe('complete');
    expect(resolveChatResumeAction({ content: '...' })).toBe('generate');
  });
});

describe('executeConversationGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.enqueueConversationGenerationJob.mockResolvedValue('job-delayed');
    modelMocks.update.mockResolvedValue({ revision: 1, status: 'cancelled' });
    modelMocks.bumpRevision.mockResolvedValue({ revision: 1, status: 'cancelled' });
    modelMocks.finalizeActive.mockResolvedValue({ revision: 1, status: 'cancelled' });
    modelMocks.insertEvent.mockResolvedValue({ id: 1 });
    modelMocks.isSupersededByLaneGeneration.mockResolvedValue(false);
    modelMocks.touchHeartbeat.mockResolvedValue({ status: 'processing' });
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({ messages: [], topics: [] });
    topicMocks.findById.mockResolvedValue(undefined);
    topicMocks.update.mockResolvedValue(undefined);
    messageMocks.findById.mockResolvedValue(undefined);
    messageMocks.update.mockResolvedValue(undefined);
    messageMocks.updateMetadata.mockResolvedValue(undefined);
    messageMocks.create.mockResolvedValue({ id: 'msg-new', content: '...' });
    runtimeMocks.chat.mockResolvedValue(new Response());
    runtimeMocks.generateObject.mockResolvedValue([]);
  });

  it('finalizes cancelled operations before claiming a worker slot', async () => {
    modelMocks.findById.mockResolvedValue({
      cancelRequestedAt: new Date('2026-08-17T00:00:00.000Z'),
      id: 'cgo_cancelled',
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    });

    await executeConversationGeneration({
      db: {} as any,
      operationId: 'cgo_cancelled',
      userId: 'user-1',
    });

    expect(modelMocks.claimForProcessing).not.toHaveBeenCalled();
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      'cgo_cancelled',
      'cancelled',
      undefined,
      expect.objectContaining({ attempt: undefined }),
    );
    expect(modelMocks.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'cgo_cancelled',
        type: 'done',
      }),
    );
  });

  it('returns without claiming when the operation is already terminal', async () => {
    modelMocks.findById.mockResolvedValue({
      id: 'cgo_done',
      status: 'succeeded',
      userId: 'user-1',
    });

    await executeConversationGeneration({
      db: {} as any,
      operationId: 'cgo_done',
      userId: 'user-1',
    });

    expect(modelMocks.claimForProcessing).not.toHaveBeenCalled();
    expect(modelMocks.finalizeActive).not.toHaveBeenCalled();
  });

  it('finalizes a cancelling row when claim loses the race', async () => {
    modelMocks.findById
      .mockResolvedValueOnce({
        id: 'cgo_claim_race',
        revision: 0,
        status: 'pending',
        userId: 'user-1',
      })
      .mockResolvedValueOnce({
        cancelRequestedAt: new Date('2026-08-18T00:00:00.000Z'),
        id: 'cgo_claim_race',
        revision: 1,
        status: 'cancelling',
        userId: 'user-1',
      });
    modelMocks.claimForProcessing.mockResolvedValue(undefined);

    await executeConversationGeneration({
      db: {} as any,
      operationId: 'cgo_claim_race',
      userId: 'user-1',
    });

    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      'cgo_claim_race',
      'cancelled',
      undefined,
      expect.objectContaining({ attempt: undefined }),
    );
  });

  it('clears tracked supervisor children when cancelling before claim', async () => {
    const child = { content: LOADING_FLAT, id: 'child-pending' };
    messageMocks.findById.mockImplementation(async (id) => (id === child.id ? child : undefined));
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === child.id) Object.assign(child, value);
    });
    modelMocks.findById.mockResolvedValue({
      cancelRequestedAt: new Date('2026-08-17T00:00:00.000Z'),
      config: {
        model: 'test-model',
        provider: 'test-provider',
        supervisorChildMessageIds: [child.id],
      },
      id: 'cgo_cancelled_children',
      revision: 0,
      status: 'cancelling',
      userId: 'user-1',
    });

    await executeConversationGeneration({
      db: {} as any,
      operationId: 'cgo_cancelled_children',
      userId: 'user-1',
    });

    expect(child.content).toBe('');
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      'cgo_cancelled_children',
      'cancelled',
      undefined,
      expect.anything(),
    );
  });

  it('finalizes superseded operations without executing', async () => {
    modelMocks.findById.mockResolvedValue({
      id: 'cgo_old',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    });
    modelMocks.claimForProcessing.mockResolvedValue({
      id: 'cgo_old',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'processing',
      userId: 'user-1',
    });
    modelMocks.isSupersededByLaneGeneration.mockResolvedValue(true);

    await executeConversationGeneration({
      db: {} as any,
      operationId: 'cgo_old',
      userId: 'user-1',
    });

    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      'cgo_old',
      'cancelled',
      expect.objectContaining({ type: 'Superseded' }),
      expect.objectContaining({ attempt: undefined, laneGeneration: 1 }),
    );
  });

  it('returns retryable failures to pending and rethrows for Graphile backoff', async () => {
    const pending = {
      attempt: 0,
      config: { model: 'test-model', provider: 'test-provider', title: { topicId: 'topic-1' } },
      id: 'cgo_retry',
      kind: 'topic_title',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      topicId: 'topic-1',
      userId: 'user-1',
    };
    const processing = { ...pending, attempt: 1, status: 'processing' };
    modelMocks.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing);
    modelMocks.claimForProcessing.mockResolvedValue(processing);
    modelMocks.markForRetry.mockResolvedValue({
      ...processing,
      revision: 2,
      status: 'pending',
    });
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({
      messages: [{ content: 'hello there', id: 'msg-user-1', role: 'user' }],
      topics: [],
    });
    vi.mocked(consumeProtocolResponse).mockResolvedValue({
      content: '',
      error: { message: 'upstream rejected the request', type: 'StreamChunkError' },
    });

    await expect(
      executeConversationGeneration({
        db: {} as any,
        operationId: pending.id,
        userId: pending.userId,
      }),
    ).rejects.toThrow();

    expect(modelMocks.markForRetry).toHaveBeenCalledWith(
      pending.id,
      expect.objectContaining({ type: 'GenerationError' }),
      1,
    );
    expect(modelMocks.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: pending.id,
        payload: expect.objectContaining({ status: 'pending' }),
        revision: 2,
        type: 'status',
      }),
    );
  });

  it('finalizes a failure after the configured final attempt', async () => {
    const pending = {
      attempt: 7,
      config: { model: 'test-model', provider: 'test-provider', title: { topicId: 'topic-1' } },
      id: 'cgo_final_attempt',
      kind: 'topic_title',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      topicId: 'topic-1',
      userId: 'user-1',
    };
    const processing = { ...pending, attempt: 8, status: 'processing' };
    modelMocks.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing);
    modelMocks.claimForProcessing.mockResolvedValue(processing);
    modelMocks.finalizeActive.mockResolvedValue({
      ...processing,
      revision: 2,
      status: 'failed',
    });
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({
      messages: [{ content: 'hello there', id: 'msg-user-1', role: 'user' }],
      topics: [],
    });
    vi.mocked(consumeProtocolResponse).mockResolvedValue({
      content: '',
      error: { message: 'upstream rejected the request', type: 'StreamChunkError' },
    });

    await executeConversationGeneration({
      db: {} as any,
      operationId: pending.id,
      userId: pending.userId,
    });

    expect(modelMocks.markForRetry).not.toHaveBeenCalled();
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      pending.id,
      'failed',
      expect.objectContaining({ type: 'GenerationError' }),
      { attempt: 8, laneGeneration: 1 },
    );
  });

  it('retries title generation without calling the model when the scoped transcript is empty', async () => {
    const pending = {
      attempt: 0,
      config: { model: 'test-model', provider: 'test-provider', title: { topicId: 'topic-1' } },
      id: 'cgo_empty_title',
      kind: 'topic_title',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      topicId: 'topic-1',
      userId: 'user-1',
    };
    const processing = { ...pending, attempt: 1, status: 'processing' };
    modelMocks.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing);
    modelMocks.claimForProcessing.mockResolvedValue(processing);
    modelMocks.markForRetry.mockResolvedValue({
      ...processing,
      revision: 2,
      status: 'pending',
    });
    topicMocks.findById.mockResolvedValue({ id: 'topic-1', title: '' });
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({ messages: [], topics: [] });

    await executeConversationGeneration({
      db: {} as any,
      operationId: pending.id,
      userId: pending.userId,
    });

    expect(runtimeMocks.chat).not.toHaveBeenCalled();
    expect(modelMocks.finalizeActive).not.toHaveBeenCalled();
    expect(aiChatMocks.getMessagesAndTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        omitSessionFilter: true,
        topicId: 'topic-1',
      }),
    );
    expect(modelMocks.markForRetry).toHaveBeenCalledWith(
      pending.id,
      expect.objectContaining({
        message: expect.stringContaining('Topic transcript is empty'),
        type: 'GenerationError',
      }),
      1,
    );
    expect(serviceMocks.enqueueConversationGenerationJob).toHaveBeenCalledWith(
      expect.anything(),
      { operationId: pending.id, userId: pending.userId },
      expect.objectContaining({
        jobKey: `${pending.id}:title-empty:1`,
        runAt: expect.any(Date),
      }),
    );
    expect(modelMocks.update).toHaveBeenCalledWith(pending.id, { workerJobId: 'job-delayed' });
    expect(generationDebugMocks.logGenerationDebugSafe).toHaveBeenCalledWith(
      'execute_transcript_loaded',
      expect.objectContaining({
        hasTopicId: true,
        kind: 'topic_title',
        omitSessionFilter: true,
        persistedSessionNull: true,
        transcriptCount: 0,
      }),
    );
    expect(generationDebugMocks.logGenerationDebugSafe).toHaveBeenCalledWith(
      'execute_retrying',
      expect.objectContaining({
        attempt: 1,
        errorClass: 'TitleTranscriptEmptyError',
        kind: 'topic_title',
      }),
    );
  });

  it('retries title generation when scoped messages only contain blank content', async () => {
    const pending = {
      attempt: 0,
      config: { model: 'test-model', provider: 'test-provider', title: { topicId: 'topic-1' } },
      id: 'cgo_blank_title',
      kind: 'topic_title',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      topicId: 'topic-1',
      userId: 'user-1',
    };
    const processing = { ...pending, attempt: 1, status: 'processing' };
    modelMocks.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing);
    modelMocks.claimForProcessing.mockResolvedValue(processing);
    modelMocks.markForRetry.mockResolvedValue({
      ...processing,
      revision: 2,
      status: 'pending',
    });
    topicMocks.findById.mockResolvedValue({ id: 'topic-1', title: '' });
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({
      messages: [{ content: '   ', id: 'msg-user-1', role: 'user' }],
      topics: [],
    });

    await executeConversationGeneration({
      db: {} as any,
      operationId: pending.id,
      userId: pending.userId,
    });

    expect(runtimeMocks.chat).not.toHaveBeenCalled();
    expect(modelMocks.finalizeActive).not.toHaveBeenCalled();
    expect(modelMocks.markForRetry).toHaveBeenCalledWith(
      pending.id,
      expect.objectContaining({ type: 'GenerationError' }),
      1,
    );
    expect(serviceMocks.enqueueConversationGenerationJob).toHaveBeenCalledWith(
      expect.anything(),
      { operationId: pending.id, userId: pending.userId },
      expect.objectContaining({
        jobKey: `${pending.id}:title-empty:1`,
        runAt: expect.any(Date),
      }),
    );
  });

  it('surfaces the upstream error type in the persisted title failure', async () => {
    const pending = {
      attempt: 0,
      config: { model: 'test-model', provider: 'test-provider', title: { topicId: 'topic-1' } },
      id: 'cgo_error_type',
      kind: 'topic_title',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      topicId: 'topic-1',
      userId: 'user-1',
    };
    const processing = { ...pending, attempt: 1, status: 'processing' };
    modelMocks.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing);
    modelMocks.claimForProcessing.mockResolvedValue(processing);
    modelMocks.markForRetry.mockResolvedValue({
      ...processing,
      revision: 2,
      status: 'pending',
    });
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({
      messages: [{ content: 'hello there', id: 'msg-user-1', role: 'user' }],
      topics: [],
    });
    vi.mocked(consumeProtocolResponse).mockResolvedValue({
      content: '',
      error: {
        message: "the message at position 1 with role 'user' must not be empty",
        type: 'InvalidRequestError',
      },
    });

    await expect(
      executeConversationGeneration({
        db: {} as any,
        operationId: pending.id,
        userId: pending.userId,
      }),
    ).rejects.toThrow(
      "the message at position 1 with role 'user' must not be empty [InvalidRequestError]",
    );

    expect(modelMocks.markForRetry).toHaveBeenCalledWith(
      pending.id,
      expect.objectContaining({
        message:
          "the message at position 1 with role 'user' must not be empty [InvalidRequestError]",
        type: 'GenerationError',
      }),
      1,
    );
  });

  it('does not double-encode the error type when it is already in the message', async () => {
    const pending = {
      attempt: 0,
      config: { model: 'test-model', provider: 'test-provider', title: { topicId: 'topic-1' } },
      id: 'cgo_error_dedupe',
      kind: 'topic_title',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      topicId: 'topic-1',
      userId: 'user-1',
    };
    const processing = { ...pending, attempt: 1, status: 'processing' };
    modelMocks.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing);
    modelMocks.claimForProcessing.mockResolvedValue(processing);
    modelMocks.markForRetry.mockResolvedValue({
      ...processing,
      revision: 2,
      status: 'pending',
    });
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({
      messages: [{ content: 'hello there', id: 'msg-user-1', role: 'user' }],
      topics: [],
    });
    // Resolver fallback shape: the type is already embedded in the message.
    vi.mocked(consumeProtocolResponse).mockResolvedValue({
      content: '',
      error: { message: 'moonshot: ProviderBizError', type: 'ProviderBizError' },
    });

    await expect(
      executeConversationGeneration({
        db: {} as any,
        operationId: pending.id,
        userId: pending.userId,
      }),
    ).rejects.toThrow('moonshot: ProviderBizError');

    expect(modelMocks.markForRetry).toHaveBeenCalledWith(
      pending.id,
      expect.objectContaining({
        message: 'moonshot: ProviderBizError',
        type: 'GenerationError',
      }),
      1,
    );
  });

  it('rethrows when claim misses a stale processing row', async () => {
    const stale = {
      heartbeatAt: new Date('2020-01-01T00:00:00.000Z'),
      id: 'cgo_stale',
      status: 'processing',
      userId: 'user-1',
    };
    modelMocks.findById.mockResolvedValue(stale);
    modelMocks.claimForProcessing.mockResolvedValue(undefined);

    await expect(
      executeConversationGeneration({
        db: {} as any,
        operationId: stale.id,
        userId: stale.userId,
      }),
    ).rejects.toThrow('Stale conversation generation is still marked processing.');
  });
});

const runOperation = async (
  row: Record<string, unknown>,
  options?: { preserveUpdate?: boolean },
) => {
  row.status = 'processing';
  row.attempt = (row.attempt as number) || 1;
  modelMocks.findById.mockImplementation(async () => ({ ...row }));
  modelMocks.claimForProcessing.mockResolvedValue(row);
  if (!options?.preserveUpdate) {
    modelMocks.update.mockImplementation(async (_id, value) => {
      Object.assign(row, value);
      if (value?.config) row.config = value.config;
      return { ...row, revision: ((row.revision as number) || 0) + 1, status: 'processing' };
    });
  }
  modelMocks.bumpRevision.mockResolvedValue({
    ...row,
    revision: ((row.revision as number) || 0) + 1,
    status: 'processing',
  });
  await executeConversationGeneration({
    db: {} as any,
    operationId: String(row.id),
    userId: String(row.userId),
  });
  return row;
};

describe('executeConversationGeneration chat resume', () => {
  const assistant = {
    content: '...',
    id: 'asst-1',
    metadata: {} as Record<string, unknown>,
    role: 'assistant',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    assistant.content = '...';
    assistant.metadata = {};
    modelMocks.insertEvent.mockResolvedValue({ id: 1 });
    modelMocks.isSupersededByLaneGeneration.mockResolvedValue(false);
    modelMocks.touchHeartbeat.mockResolvedValue({ status: 'processing' });
    modelMocks.markForRetry.mockImplementation(async (id, error, attempt) => ({
      attempt,
      error,
      id,
      revision: 4,
      status: 'pending',
    }));
    modelMocks.finalizeActive.mockImplementation(async (id, status) => ({
      id,
      revision: 5,
      status,
    }));
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({
      messages: [{ content: 'hi', id: 'user-1', role: 'user' }],
      topics: [],
    });
    messageMocks.findById.mockImplementation(async (id) =>
      id === assistant.id ? { ...assistant, metadata: { ...assistant.metadata } } : undefined,
    );
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === assistant.id) Object.assign(assistant, value);
    });
    messageMocks.updateMetadata.mockImplementation(async (id, value) => {
      if (id === assistant.id) assistant.metadata = { ...assistant.metadata, ...value };
    });
    runtimeMocks.chat.mockResolvedValue(new Response());
  });

  const buildOperation = (overrides: Record<string, unknown> = {}) => ({
    assistantMessageId: assistant.id,
    attempt: 0,
    config: { model: 'test-model', provider: 'test-provider' },
    id: 'cgo_test_operation',
    kind: 'chat',
    lane: 'lane-1',
    laneGeneration: 1,
    revision: 0,
    sessionId: 'session-1',
    status: 'pending',
    userId: 'user-1',
    ...overrides,
  });

  it('does not treat a checkpointed partial as success and calls the model again', async () => {
    const row = {
      assistantMessageId: assistant.id,
      attempt: 0,
      config: { model: 'test-model', provider: 'test-provider' },
      id: 'cgo_partial',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    vi.mocked(consumeProtocolResponse)
      .mockImplementationOnce(async (_response, handlers) => {
        await handlers?.onText?.('x'.repeat(40), 'x'.repeat(40));
        throw new Error('stream dropped');
      })
      .mockResolvedValueOnce({ content: 'completed answer' });

    await expect(runOperation(row)).rejects.toThrow('stream dropped');
    expect(runtimeMocks.chat).toHaveBeenCalledTimes(1);
    expect(modelMocks.finalizeActive).not.toHaveBeenCalledWith(
      row.id,
      'succeeded',
      undefined,
      expect.anything(),
    );

    row.attempt = 1;
    assistant.content = 'x'.repeat(40);
    await runOperation(row);

    expect(runtimeMocks.chat).toHaveBeenCalledTimes(2);
    expect(assistant.metadata[CONVERSATION_GENERATION_TURN_COMPLETE]).toBe(true);
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'succeeded',
      undefined,
      expect.objectContaining({ attempt: 1 }),
    );
  });

  it('skips a second model call after the completion marker is persisted', async () => {
    const row = {
      assistantMessageId: assistant.id,
      attempt: 0,
      config: { model: 'test-model', provider: 'test-provider' },
      id: 'cgo_complete',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    vi.mocked(consumeProtocolResponse).mockResolvedValue({ content: 'complete answer' });
    modelMocks.finalizeActive
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce({ id: row.id, revision: 5, status: 'succeeded' });

    await expect(runOperation(row)).rejects.toThrow('disk full');
    expect(runtimeMocks.chat).toHaveBeenCalledTimes(1);
    expect(assistant.metadata[CONVERSATION_GENERATION_TURN_COMPLETE]).toBe(true);

    row.attempt = 1;
    assistant.content = 'complete answer';
    await runOperation(row);

    expect(runtimeMocks.chat).toHaveBeenCalledTimes(1);
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'succeeded',
      undefined,
      expect.objectContaining({ attempt: 1 }),
    );
  });

  it('hands off a failed inline title to a dedicated topic_title operation without failing the chat', async () => {
    const row = {
      assistantMessageId: assistant.id,
      attempt: 0,
      config: {
        model: 'test-model',
        provider: 'test-provider',
        title: { force: true, topicId: 'topic-1' },
      },
      id: 'cgo_chat_title_handoff',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      sessionId: 'session-1',
      status: 'pending',
      userId: 'user-1',
    };
    vi.mocked(consumeProtocolResponse).mockResolvedValue({ content: 'the answer' });
    // The title scope has no transcript yet (message-binding race).
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({ messages: [], topics: [] });
    topicMocks.findById.mockResolvedValue({ id: 'topic-1', title: '' });
    serviceMocks.enqueue.mockResolvedValue({ id: 'cgo_title_handoff' });

    await runOperation(row);

    // The chat reply still succeeds even though the inline title could not run.
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'succeeded',
      undefined,
      expect.objectContaining({ attempt: 1 }),
    );
    expect(modelMocks.markForRetry).not.toHaveBeenCalled();
    // The title is handed off through the public, version-locked enqueue path.
    expect(serviceMocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          model: 'test-model',
          provider: 'test-provider',
          title: { force: true, topicId: 'topic-1' },
        }),
        idempotencyKey: `${row.id}:title-handoff`,
        kind: 'topic_title',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    );
  });

  it('persists a pending title marker when the handoff enqueue fails, so the sweeper retries it', async () => {
    const row = buildOperation({
      config: {
        model: 'test-model',
        provider: 'test-provider',
        title: { force: true, topicId: 'topic-1' },
      },
      kind: 'chat',
    });
    vi.mocked(consumeProtocolResponse).mockResolvedValue({ content: 'the answer' });
    // Empty transcript makes the inline title throw, triggering the handoff.
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({ messages: [], topics: [] });
    topicMocks.findById.mockResolvedValue({ id: 'topic-1', title: '' });
    serviceMocks.enqueue.mockRejectedValueOnce(new Error('worker queue unavailable'));
    vi.mocked(withConversationWriteLockOrThrow).mockImplementationOnce(
      async (_db, _userId, callback) => callback({} as any),
    );
    modelMocks.findMaxLaneGeneration.mockResolvedValue(0);

    await runOperation(row);

    // The chat reply still succeeds; the title must not be silently lost.
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'succeeded',
      undefined,
      expect.objectContaining({ attempt: 1 }),
    );
    // A durable pending marker is created so the pending sweeper re-enqueues it.
    expect(modelMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `${row.id}:title-handoff`,
        kind: 'topic_title',
        laneGeneration: 1,
        topicId: 'topic-1',
      }),
    );
  });

  it('skips the handoff marker when a CONFLICT means an active topic_title already covers the lane', async () => {
    const row = buildOperation({
      config: {
        model: 'test-model',
        provider: 'test-provider',
        title: { force: true, topicId: 'topic-1' },
      },
      kind: 'chat',
    });
    vi.mocked(consumeProtocolResponse).mockResolvedValue({ content: 'the answer' });
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({ messages: [], topics: [] });
    topicMocks.findById.mockResolvedValue({ id: 'topic-1', title: '' });
    serviceMocks.enqueue.mockRejectedValueOnce(
      new TRPCError({ code: 'CONFLICT', message: 'active operation exists' }),
    );
    modelMocks.findActiveByLane.mockResolvedValueOnce(buildOperation({ kind: 'topic_title' }));

    await runOperation(row);

    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'succeeded',
      undefined,
      expect.objectContaining({ attempt: 1 }),
    );
    // The title is already covered by an active operation: no marker needed.
    expect(modelMocks.create).not.toHaveBeenCalled();
  });

  it('persists the handoff marker when a CONFLICT active operation is not a topic_title', async () => {
    const row = buildOperation({
      config: {
        model: 'test-model',
        provider: 'test-provider',
        title: { force: true, topicId: 'topic-1' },
      },
      kind: 'chat',
    });
    vi.mocked(consumeProtocolResponse).mockResolvedValue({ content: 'the answer' });
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({ messages: [], topics: [] });
    topicMocks.findById.mockResolvedValue({ id: 'topic-1', title: '' });
    serviceMocks.enqueue.mockRejectedValueOnce(
      new TRPCError({ code: 'CONFLICT', message: 'active operation exists' }),
    );
    // First findActiveByLane call (CONFLICT verification) sees a non-title owner;
    // the marker's own lane check then finds no active title operation.
    modelMocks.findActiveByLane
      .mockResolvedValueOnce(buildOperation({ kind: 'chat' }))
      .mockResolvedValueOnce(undefined);
    vi.mocked(withConversationWriteLockOrThrow).mockImplementationOnce(
      async (_db, _userId, callback) => callback({} as any),
    );
    modelMocks.findMaxLaneGeneration.mockResolvedValue(0);

    await runOperation(row);

    expect(modelMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `${row.id}:title-handoff`,
        kind: 'topic_title',
      }),
    );
  });

  it('does not persist a handoff marker when the conversation was cleared', async () => {
    const row = buildOperation({
      config: {
        model: 'test-model',
        provider: 'test-provider',
        title: { force: true, topicId: 'topic-1' },
      },
      kind: 'chat',
    });
    vi.mocked(consumeProtocolResponse).mockResolvedValue({ content: 'the answer' });
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({ messages: [], topics: [] });
    topicMocks.findById.mockResolvedValue({ id: 'topic-1', title: '' });
    serviceMocks.enqueue.mockRejectedValueOnce(new ConversationWriteRejectedError());

    await runOperation(row);

    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'succeeded',
      undefined,
      expect.objectContaining({ attempt: 1 }),
    );
    expect(modelMocks.create).not.toHaveBeenCalled();
  });

  it('preserves the structured upstream error body when a simple completion fails', async () => {
    const upstreamError = {
      body: { error: { status: 400 }, provider: 'moonshot' },
      message: 'moonshot: empty message rejected',
      type: 'ProviderBizError',
    };
    vi.mocked(consumeProtocolResponse).mockResolvedValueOnce({
      content: '',
      error: upstreamError,
    });
    // A topic_title operation exercises the runSimpleCompletion path.
    const row = buildOperation({
      assistantMessageId: undefined,
      config: {
        model: 'test-model',
        provider: 'test-provider',
        title: { force: true, topicId: 'topic-1' },
      },
      kind: 'topic_title',
      topicId: 'topic-1',
    });
    topicMocks.findById.mockResolvedValue({ id: 'topic-1', title: '' });
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({
      messages: [{ content: 'hello there', id: 'msg-user-1', role: 'user' }],
      topics: [],
    });

    // The retryable upstream failure is rethrown for Graphile backoff.
    await expect(runOperation(row)).rejects.toThrow();

    expect(modelMocks.markForRetry).toHaveBeenCalledWith(
      row.id,
      expect.objectContaining({
        body: upstreamError.body,
        message: 'moonshot: empty message rejected [ProviderBizError]',
        type: 'GenerationError',
      }),
      1,
    );
  });

  it('passes cache diagnostics and a trusted prompt-cache key into ModelRuntime', async () => {
    vi.stubEnv('DEBUG_OPENAI_CACHE', '1');
    vi.stubEnv('KEY_VAULTS_SECRET', 'conversation-cache-fingerprint-secret');
    try {
      const row = {
        assistantMessageId: assistant.id,
        attempt: 0,
        config: { model: 'gpt-5.6', provider: 'openai' },
        id: 'cgo_cache_debug',
        kind: 'chat',
        lane: 'lane-1',
        laneGeneration: 1,
        revision: 0,
        sessionId: 'session-1',
        status: 'pending',
        topicId: 'topic-1',
        userId: 'user-1',
      };
      vi.mocked(consumeProtocolResponse).mockResolvedValue({ content: 'complete answer' });

      await runOperation(row);

      expect(runtimeMocks.chat).toHaveBeenCalledTimes(1);
      expect(runtimeMocks.chat.mock.calls[0][1]).toMatchObject({
        cacheDiagnostics: {
          provider: 'openai',
          runtimeFamily: 'openai',
        },
        runtimeProvider: 'openai',
        trustedPromptCacheKey: expect.stringMatching(/^ch_[\da-f]{32}$/),
        user: 'user-1',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uses resolved runtimeProvider for cache diagnostics on custom gateways', async () => {
    const { resolveConversationRuntimePayload } = await import('./credentials');
    vi.mocked(resolveConversationRuntimePayload).mockResolvedValue({
      apiKey: 'test-key',
      runtimeProvider: 'openai',
    } as any);
    vi.stubEnv('DEBUG_OPENAI_CACHE', '1');
    vi.stubEnv('KEY_VAULTS_SECRET', 'conversation-cache-fingerprint-secret');
    try {
      const row = {
        assistantMessageId: assistant.id,
        attempt: 0,
        config: { model: 'gpt-5.6', provider: 'gateway' },
        id: 'cgo_gateway_cache',
        kind: 'chat',
        lane: 'lane-1',
        laneGeneration: 1,
        revision: 0,
        sessionId: 'session-1',
        status: 'pending',
        topicId: 'topic-1',
        userId: 'user-1',
      };
      vi.mocked(consumeProtocolResponse).mockResolvedValue({ content: 'complete answer' });

      await runOperation(row);

      expect(runtimeMocks.chat).toHaveBeenCalledTimes(1);
      expect(runtimeMocks.chat.mock.calls[0][1]).toMatchObject({
        cacheDiagnostics: {
          provider: 'openai',
          runtimeFamily: 'openai',
        },
        runtimeProvider: 'openai',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('executeConversationGeneration supervisor children', () => {
  const children: Array<{
    content: string;
    error?: unknown;
    id: string;
    metadata?: Record<string, unknown>;
  }> = [];
  const row = {
    attempt: 0,
    config: { model: 'test-model', provider: 'test-provider' } as Record<string, unknown>,
    groupId: 'group-1',
    id: 'cgo_supervisor',
    kind: 'group_supervisor',
    lane: 'lane-supervisor',
    laneGeneration: 1,
    revision: 0,
    status: 'pending',
    userId: 'user-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    children.length = 0;
    row.attempt = 0;
    row.status = 'pending';
    row.config = { model: 'test-model', provider: 'test-provider' };
    delete (row as { cancelRequestedAt?: Date }).cancelRequestedAt;
    modelMocks.insertEvent.mockResolvedValue({ id: 1 });
    modelMocks.isSupersededByLaneGeneration.mockResolvedValue(false);
    modelMocks.touchHeartbeat.mockResolvedValue({ status: 'processing' });
    modelMocks.update.mockImplementation(async (_id, value) => {
      Object.assign(row, value);
      if (value.config) row.config = value.config;
      return { ...row, revision: 2, status: row.status === 'pending' ? 'processing' : row.status };
    });
    modelMocks.appendSupervisorChildMessageId.mockImplementation(async (_id, childId) => {
      const config = row.config as { supervisorChildMessageIds?: string[] };
      const ids = [...new Set([...(config.supervisorChildMessageIds || []), childId])];
      row.config = { ...config, supervisorChildMessageIds: ids };
      return { ...row };
    });
    modelMocks.bumpRevision.mockResolvedValue({ ...row, revision: 3, status: 'processing' });
    modelMocks.finalizeActive.mockImplementation(async (id, status, error) => ({
      error,
      id,
      revision: 9,
      status,
    }));
    runtimeMocks.chat.mockReset();
    runtimeMocks.chat.mockResolvedValue(new Response());
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({
      messages: [{ content: 'hello', id: 'user-1', role: 'user' }],
      topics: [],
    });
    vi.mocked(UserModel.findById).mockResolvedValue({ username: 'User' } as any);
    chatGroupMocks.findById.mockResolvedValue({
      config: { allowDM: true, responseOrder: 'sequential' },
      id: 'group-1',
    });
    chatGroupMocks.getEnabledGroupAgents.mockResolvedValue([
      { agentId: 'agent-1', order: 0 },
      { agentId: 'agent-2', order: 1 },
    ]);
    agentMocks.getAgentConfigById.mockImplementation(async (id: string) => ({
      id,
      model: 'member-model',
      provider: 'member-provider',
      title: id,
    }));
    messageMocks.create.mockImplementation(async (params, id) => {
      const created = {
        content: params.content,
        id: id ?? `child-${children.length + 1}`,
      };
      children.push(created);
      return created;
    });
    messageMocks.findById.mockImplementation(async (id) => children.find((item) => item.id === id));
    messageMocks.update.mockImplementation(async (id, value) => {
      const current = children.find((item) => item.id === id);
      if (current) Object.assign(current, value);
    });
    messageMocks.updateMetadata.mockImplementation(async (id, value) => {
      const current = children.find((item) => item.id === id);
      if (current) current.metadata = { ...(current.metadata || {}), ...value };
    });
    vi.mocked(consumeProtocolResponse).mockReset();
    vi.mocked(consumeProtocolResponse).mockResolvedValue({ content: 'member answer' });
    runtimeMocks.generateObject.mockResolvedValue([
      { arguments: { id: 'agent-1' }, name: 'trigger_agent' },
    ]);
  });

  it('clears a sequential child placeholder when Stop arrives before the first token', async () => {
    messageMocks.create.mockImplementation(async (params, id) => {
      const created = {
        content: params.content,
        id: id ?? `child-${children.length + 1}`,
      };
      children.push(created);
      (row as { cancelRequestedAt?: Date }).cancelRequestedAt = new Date();
      row.status = 'cancelling';
      return created;
    });

    await runOperation(row);

    expect(children[0]?.content).toBe('');
    expect(runtimeMocks.chat).not.toHaveBeenCalled();
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'cancelled',
      undefined,
      expect.anything(),
    );
  });

  it('clears every parallel child placeholder when Stop arrives before the first token', async () => {
    chatGroupMocks.findById.mockResolvedValue({
      config: { allowDM: true, responseOrder: 'natural' },
      id: 'group-1',
    });
    runtimeMocks.generateObject.mockResolvedValue([
      { arguments: { id: 'agent-1' }, name: 'trigger_agent' },
      { arguments: { id: 'agent-2' }, name: 'trigger_agent' },
    ]);
    messageMocks.create.mockImplementation(async (params, id) => {
      const created = {
        content: params.content,
        id: id ?? `child-${children.length + 1}`,
      };
      children.push(created);
      if (children.length === 2) {
        (row as { cancelRequestedAt?: Date }).cancelRequestedAt = new Date();
        row.status = 'cancelling';
      }
      return created;
    });

    await runOperation(row);

    expect(children.map((item) => item.content)).toEqual(['', '']);
    expect(runtimeMocks.chat).not.toHaveBeenCalled();
  });

  it('clears child placeholders after a final-attempt runtime failure', async () => {
    row.attempt = 8;
    runtimeMocks.chat.mockRejectedValue(new Error('member runtime failed'));

    await runOperation({ ...row, attempt: 8 });

    expect(children[0]?.content).toBe('');
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'failed',
      expect.objectContaining({ type: 'GenerationError' }),
      expect.objectContaining({ attempt: 8 }),
    );
  });

  it('does not stamp a sibling failure onto a completed sequential member', async () => {
    runtimeMocks.generateObject.mockResolvedValue([
      { arguments: { id: 'agent-1' }, name: 'trigger_agent' },
      { arguments: { id: 'agent-2' }, name: 'trigger_agent' },
    ]);
    runtimeMocks.chat
      .mockResolvedValueOnce(new Response())
      .mockRejectedValueOnce(new Error('agent 2 failed'));

    await runOperation({ ...row, attempt: 8 });

    expect(children[0]?.content).toBe('member answer');
    expect(children[0]?.error).toBeUndefined();
    expect(children[1]?.content).toBe('');
    expect(children[1]?.error).toMatchObject({ type: 'GenerationError' });
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'failed',
      expect.objectContaining({ type: 'GenerationError' }),
      expect.anything(),
    );
  });

  it('waits for a delayed parallel sibling before finalizing a failed parent', async () => {
    chatGroupMocks.findById.mockResolvedValue({
      config: { allowDM: true, responseOrder: 'natural' },
      id: 'group-1',
    });
    runtimeMocks.generateObject.mockResolvedValue([
      { arguments: { id: 'agent-1' }, name: 'trigger_agent' },
      { arguments: { id: 'agent-2' }, name: 'trigger_agent' },
    ]);

    let parentFinalized = false;
    let writesAfterFinalize = 0;
    let delayedWriteAt = 0;
    let finalizedAt = 0;
    let resolveChild2 = () => {};
    const child2EnteredChat = new Promise<void>((resolve) => {
      resolveChild2 = resolve;
    });
    modelMocks.finalizeActive.mockImplementation(async (id, status, error) => {
      parentFinalized = true;
      finalizedAt = Date.now();
      return { error, id, revision: 9, status };
    });
    runtimeMocks.chat.mockImplementation(async () => {
      const call = runtimeMocks.chat.mock.calls.length;
      if (call === 1) {
        await child2EnteredChat;
        throw new Error('member 1 failed');
      }
      resolveChild2();
      await new Promise((resolve) => {
        setTimeout(resolve, 40);
      });
      const delayed = children[1] || children.at(-1);
      if (delayed) {
        delayed.content = 'delayed sibling';
        delayedWriteAt = Date.now();
        if (parentFinalized) writesAfterFinalize += 1;
      }
      return new Response();
    });
    vi.mocked(consumeProtocolResponse).mockImplementation(async () => {
      if (parentFinalized) writesAfterFinalize += 1;
      return { content: 'delayed sibling' };
    });

    await runOperation({ ...row, attempt: 8 });

    expect(delayedWriteAt).toBeGreaterThan(0);
    expect(finalizedAt).toBeGreaterThanOrEqual(delayedWriteAt);
    expect(writesAfterFinalize).toBe(0);
    expect(children[1]?.content).toBe('delayed sibling');
    expect(children[1]?.error).toBeUndefined();
    expect(children[0]?.error).toMatchObject({ type: 'GenerationError' });
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'failed',
      expect.objectContaining({ type: 'GenerationError' }),
      expect.anything(),
    );
  });

  it('creates the child placeholder before assigning the persisted child id', async () => {
    const order: string[] = [];
    modelMocks.update.mockImplementation(async (_id, value) => {
      Object.assign(row, value);
      if (value.config) row.config = value.config;
      return { ...row, revision: 2, status: 'processing' };
    });
    modelMocks.appendSupervisorChildMessageId.mockImplementation(async (_id, childId) => {
      order.push(`persist:${childId}`);
      const config = row.config as { supervisorChildMessageIds?: string[] };
      const ids = [...new Set([...(config.supervisorChildMessageIds || []), childId])];
      row.config = { ...config, supervisorChildMessageIds: ids };
      return { ...row };
    });
    messageMocks.create.mockImplementation(async (params, id) => {
      order.push(`create:${id}`);
      const created = { content: params.content, id };
      children.push(created);
      return created;
    });

    await runOperation(row, { preserveUpdate: true });

    expect(order[0]).toMatch(/^create:/);
    expect(order[1]).toMatch(/^persist:/);
    expect(order[0]?.slice('create:'.length)).toBe(order[1]?.slice('persist:'.length));
  });

  it('clears a child row when id persistence fails after insert', async () => {
    modelMocks.update.mockImplementation(async (_id, value) => {
      Object.assign(row, value);
      return { ...row, revision: 2, status: 'processing' };
    });
    modelMocks.appendSupervisorChildMessageId.mockRejectedValue(new Error('config persist failed'));

    await expect(runOperation(row, { preserveUpdate: true })).rejects.toThrow(
      'config persist failed',
    );
    expect(messageMocks.create).toHaveBeenCalled();
    expect(children[0]?.content).toBe('');
  });

  it('annotates the latest group-agent continuation instead of the original child', async () => {
    row.attempt = 8;
    vi.mocked(executeConversationToolStep).mockResolvedValue({
      content: 'tool result',
      inputHash: 'hash-1',
      messageId: 'tool-1',
      shouldContinue: true,
      success: true,
    });
    let consumeCalls = 0;
    vi.mocked(consumeProtocolResponse).mockImplementation(async () => {
      consumeCalls += 1;
      if (consumeCalls === 1) {
        return {
          content: 'calling tool',
          toolCalls: [{ function: { arguments: '{}', name: 'plugin____search' }, id: 'call-1' }],
        };
      }
      throw new Error('nested continuation failed');
    });

    await runOperation({ ...row, attempt: 8 });

    expect(children).toHaveLength(2);
    expect(children[0]?.error).toBeUndefined();
    expect(children[0]?.content).toBe('calling tool');
    expect(children[1]?.error).toMatchObject({ type: 'GenerationError' });
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'failed',
      expect.objectContaining({ type: 'GenerationError' }),
      expect.anything(),
    );
  });

  it('keeps the member model and group prompt on a tool continuation', async () => {
    agentMocks.getAgentConfigById.mockImplementation(async (id: string) => ({
      id,
      model: 'member-model',
      plugins: ['lobe-web-browsing'],
      provider: 'member-provider',
      systemRole: 'member-base-role',
      title: id,
    }));
    vi.mocked(executeConversationToolStep).mockResolvedValue({
      content: 'tool result',
      inputHash: 'hash-1',
      messageId: 'tool-1',
      shouldContinue: true,
      success: true,
    });
    let consumeCalls = 0;
    vi.mocked(consumeProtocolResponse).mockImplementation(async () => {
      consumeCalls += 1;
      if (consumeCalls === 1) {
        return {
          content: 'calling tool',
          toolCalls: [{ function: { arguments: '{}', name: 'plugin____search' }, id: 'call-1' }],
        };
      }
      return { content: 'member continuation' };
    });

    await runOperation({ ...row, attempt: 8 });

    const continuationConfig = vi
      .mocked(buildConversationChatPayload)
      .mock.calls.at(-1)?.[0]?.config;
    expect(vi.mocked(buildConversationChatPayload).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(continuationConfig).toMatchObject({
      model: 'member-model',
      plugins: ['lobe-web-browsing'],
      provider: 'member-provider',
    });
    expect(continuationConfig?.systemRole).toContain('Stay in character as agent-1');
    expect(continuationConfig?.model).not.toBe(row.config.model);
  });
});

describe('executeConversationGeneration tool continuation ids', () => {
  const assistant = {
    content: LOADING_FLAT,
    id: 'asst-1',
    metadata: {} as Record<string, unknown>,
    role: 'assistant',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    assistant.content = LOADING_FLAT;
    assistant.metadata = {};
    delete (assistant as { error?: unknown }).error;
    delete (assistant as { tools?: unknown }).tools;
    modelMocks.insertEvent.mockResolvedValue({ id: 1 });
    modelMocks.isSupersededByLaneGeneration.mockResolvedValue(false);
    modelMocks.touchHeartbeat.mockResolvedValue({ status: 'processing' });
    modelMocks.finalizeActive.mockImplementation(async (id, status) => ({
      id,
      revision: 5,
      status,
    }));
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({
      messages: [{ content: 'hi', id: 'user-1', role: 'user' }],
      topics: [],
    });
    messageMocks.findById.mockImplementation(async (id) =>
      id === assistant.id ? { ...assistant, metadata: { ...assistant.metadata } } : undefined,
    );
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === assistant.id) Object.assign(assistant, value);
    });
    messageMocks.updateMetadata.mockImplementation(async (id, value) => {
      if (id === assistant.id) assistant.metadata = { ...assistant.metadata, ...value };
    });
    runtimeMocks.chat.mockReset();
    runtimeMocks.chat.mockResolvedValue(new Response());
    vi.mocked(executeConversationToolStep).mockReset();
    vi.mocked(executeConversationToolStep).mockResolvedValue({
      content: 'tool result',
      inputHash: 'hash-1',
      messageId: 'tool-1',
      shouldContinue: true,
      success: true,
    });
    vi.mocked(getConversationVersion).mockReset();
    vi.mocked(getConversationVersion).mockResolvedValue(1);
    vi.mocked(consumeProtocolResponse).mockReset();
  });

  it('creates the continuation placeholder before assigning the next assistant id', async () => {
    const created: Array<{ content: string; id: string }> = [];
    const order: string[] = [];
    const row = {
      assistantMessageId: assistant.id,
      attempt: 0,
      config: { model: 'test-model', provider: 'test-provider' },
      id: 'cgo_continue',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    modelMocks.update.mockImplementation(async (_id, value) => {
      if (value.assistantMessageId && value.assistantMessageId !== assistant.id) {
        order.push(`persist:${value.assistantMessageId}`);
      }
      Object.assign(row, value);
      return { ...row, revision: 2, status: 'processing' };
    });
    messageMocks.create.mockImplementation(async (params, id) => {
      order.push(`create:${id}`);
      const next = { content: params.content, id };
      created.push(next);
      messageMocks.findById.mockImplementation(async (messageId) => {
        if (messageId === assistant.id) return { ...assistant };
        return created.find((item) => item.id === messageId);
      });
      return next;
    });
    vi.mocked(consumeProtocolResponse)
      .mockResolvedValueOnce({
        content: 'calling tool',
        toolCalls: [{ function: { arguments: '{}', name: 'plugin____search' }, id: 'call-1' }],
      })
      .mockResolvedValueOnce({ content: 'final answer' });

    await runOperation(row, { preserveUpdate: true });

    expect(order[0]).toMatch(/^create:/);
    expect(order[1]).toMatch(/^persist:/);
    expect(order[0]?.slice('create:'.length)).toBe(order[1]?.slice('persist:'.length));
  });

  it('reports HTTP MCP tool completions with runtimeType mcp', async () => {
    const report = vi.spyOn(toolDiagnostics, 'reportConversationToolCompletion');
    vi.mocked(executeConversationToolStep).mockResolvedValue({
      content: 'mcp ok',
      inputHash: 'hash-mcp',
      isHttpMcp: true,
      messageId: 'tool-mcp',
      shouldContinue: true,
      success: true,
    });
    const row = {
      assistantMessageId: assistant.id,
      attempt: 0,
      config: { model: 'test-model', provider: 'test-provider' },
      id: 'cgo_mcp_tool',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    vi.mocked(consumeProtocolResponse)
      .mockResolvedValueOnce({
        content: 'calling tool',
        toolCalls: [{ function: { arguments: '{}', name: 'notion____search' }, id: 'call-mcp' }],
      })
      .mockResolvedValueOnce({ content: 'final answer' });

    await runOperation(row, { preserveUpdate: true });

    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'notion',
        isHttpMcp: true,
        outcome: 'completed',
        toolCallId: 'call-mcp',
      }),
    );
  });

  it('reports failed tool completions when executeConversationToolStep throws', async () => {
    const report = vi.spyOn(toolDiagnostics, 'reportConversationToolCompletion');
    vi.mocked(executeConversationToolStep).mockRejectedValue(new Error('tool exploded'));
    const row = {
      assistantMessageId: assistant.id,
      attempt: 0,
      config: { model: 'test-model', provider: 'test-provider' },
      id: 'cgo_tool_throw',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    vi.mocked(consumeProtocolResponse).mockResolvedValueOnce({
      content: 'calling tool',
      toolCalls: [{ function: { arguments: '{}', name: 'plugin____search' }, id: 'call-fail' }],
    });

    await expect(runOperation(row, { preserveUpdate: true })).rejects.toThrow('tool exploded');
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'plugin',
        outcome: 'failed',
        toolCallId: 'call-fail',
      }),
    );
  });

  it('reports thrown HTTP MCP tool completions with runtimeType mcp', async () => {
    const report = vi.spyOn(toolDiagnostics, 'reportConversationToolCompletion');
    vi.mocked(resolveConversationToolHttpMcp).mockResolvedValueOnce(true);
    vi.mocked(executeConversationToolStep).mockRejectedValue(new Error('mcp oauth failed'));
    const row = {
      assistantMessageId: assistant.id,
      attempt: 0,
      config: { model: 'test-model', provider: 'test-provider' },
      id: 'cgo_mcp_throw',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    vi.mocked(consumeProtocolResponse).mockResolvedValueOnce({
      content: 'calling tool',
      toolCalls: [{ function: { arguments: '{}', name: 'plugin____mcp' }, id: 'call-mcp-fail' }],
    });

    await expect(runOperation(row, { preserveUpdate: true })).rejects.toThrow('mcp oauth failed');
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'plugin',
        isHttpMcp: true,
        outcome: 'failed',
        toolCallId: 'call-mcp-fail',
      }),
    );
  });

  it('clears the continuation row when id persistence fails after insert', async () => {
    const created: Array<{ content: string; error?: unknown; id: string }> = [];
    const row = {
      assistantMessageId: assistant.id,
      attempt: 0,
      config: { model: 'test-model', provider: 'test-provider' },
      id: 'cgo_continue_fail',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    modelMocks.update.mockImplementation(async (_id, value) => {
      if (value.assistantMessageId && value.assistantMessageId !== assistant.id) {
        throw new Error('assistant id persist failed');
      }
      Object.assign(row, value);
      return { ...row, revision: 2, status: 'processing' };
    });
    messageMocks.create.mockImplementation(async (params, id) => {
      const next = { content: params.content, id };
      created.push(next);
      messageMocks.findById.mockImplementation(async (messageId) => {
        if (messageId === assistant.id) return { ...assistant };
        return created.find((item) => item.id === messageId);
      });
      return next;
    });
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === assistant.id) Object.assign(assistant, value);
      const current = created.find((item) => item.id === id);
      if (current) Object.assign(current, value);
    });
    vi.mocked(consumeProtocolResponse).mockResolvedValue({
      content: 'calling tool',
      toolCalls: [{ function: { arguments: '{}', name: 'plugin____search' }, id: 'call-1' }],
    });

    await expect(runOperation(row, { preserveUpdate: true })).rejects.toThrow(
      'assistant id persist failed',
    );
    expect(messageMocks.create).toHaveBeenCalled();
    expect(created[0]?.content).toBe('');
  });

  it('annotates the continuation assistant after a final-attempt failure', async () => {
    const created: Array<{ content: string; error?: unknown; id: string }> = [];
    const row = {
      assistantMessageId: assistant.id,
      attempt: 8,
      config: { model: 'test-model', provider: 'test-provider' },
      id: 'cgo_continue_fail_latest',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    modelMocks.update.mockImplementation(async (_id, value) => {
      Object.assign(row, value);
      return { ...row, revision: 2, status: 'processing' };
    });
    messageMocks.create.mockImplementation(async (params, id) => {
      const next = { content: params.content, id };
      created.push(next);
      return next;
    });
    messageMocks.findById.mockImplementation(async (messageId) => {
      if (messageId === assistant.id) return assistant;
      return created.find((item) => item.id === messageId);
    });
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === assistant.id) Object.assign(assistant, value);
      const current = created.find((item) => item.id === id);
      if (current) Object.assign(current, value);
    });
    let consumeCalls = 0;
    vi.mocked(consumeProtocolResponse).mockImplementation(async () => {
      consumeCalls += 1;
      if (consumeCalls === 1) {
        return {
          content: 'calling tool',
          toolCalls: [{ function: { arguments: '{}', name: 'plugin____search' }, id: 'call-1' }],
        };
      }
      throw new Error('continuation failed');
    });

    await runOperation(row, { preserveUpdate: true });

    expect(created[0]?.error).toMatchObject({ type: 'GenerationError' });
    expect(assistant.error).toBeUndefined();
    expect(assistant.tools).toEqual([expect.objectContaining({ id: 'call-1' })]);
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'failed',
      expect.objectContaining({ type: 'GenerationError' }),
      expect.anything(),
    );
  });

  it('clears the continuation placeholder on cancel without failing the tool-call row', async () => {
    const created: Array<{ content: string; error?: unknown; id: string }> = [];
    const row = {
      assistantMessageId: assistant.id,
      attempt: 1,
      config: { model: 'test-model', provider: 'test-provider' },
      id: 'cgo_continue_cancel_latest',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    modelMocks.update.mockImplementation(async (_id, value) => {
      Object.assign(row, value);
      return { ...row, revision: 2, status: 'processing' };
    });
    messageMocks.create.mockImplementation(async (params, id) => {
      const next = { content: params.content, id };
      created.push(next);
      (row as { cancelRequestedAt?: Date }).cancelRequestedAt = new Date();
      row.status = 'cancelling';
      return next;
    });
    messageMocks.findById.mockImplementation(async (messageId) => {
      if (messageId === assistant.id) return assistant;
      return created.find((item) => item.id === messageId);
    });
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === assistant.id) Object.assign(assistant, value);
      const current = created.find((item) => item.id === id);
      if (current) Object.assign(current, value);
    });
    vi.mocked(consumeProtocolResponse).mockResolvedValue({
      content: 'calling tool',
      toolCalls: [{ function: { arguments: '{}', name: 'plugin____search' }, id: 'call-1' }],
    });

    await runOperation(row, { preserveUpdate: true });

    expect(created[0]?.content).toBe('');
    expect(created[0]?.error).toBeUndefined();
    expect(assistant.error).toBeUndefined();
    expect(assistant.content).toBe('calling tool');
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'cancelled',
      undefined,
      expect.anything(),
    );
  });

  it('annotates the continuation assistant when conversation history is cleared', async () => {
    const created: Array<{ content: string; error?: unknown; id: string }> = [];
    const row = {
      assistantMessageId: assistant.id,
      attempt: 8,
      config: { model: 'test-model', provider: 'test-provider' },
      conversationVersion: 1,
      id: 'cgo_continue_cleared_latest',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    vi.mocked(getConversationVersion).mockResolvedValue(1);
    modelMocks.update.mockImplementation(async (_id, value) => {
      Object.assign(row, value);
      return { ...row, revision: 2, status: 'processing' };
    });
    messageMocks.create.mockImplementation(async (params, id) => {
      const next = { content: params.content, id };
      created.push(next);
      vi.mocked(getConversationVersion).mockResolvedValue(2);
      return next;
    });
    messageMocks.findById.mockImplementation(async (messageId) => {
      if (messageId === assistant.id) return assistant;
      return created.find((item) => item.id === messageId);
    });
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === assistant.id) Object.assign(assistant, value);
      const current = created.find((item) => item.id === id);
      if (current) Object.assign(current, value);
    });
    vi.mocked(consumeProtocolResponse).mockResolvedValue({
      content: 'calling tool',
      toolCalls: [{ function: { arguments: '{}', name: 'plugin____search' }, id: 'call-1' }],
    });

    await runOperation(row, { preserveUpdate: true });

    expect(created[0]?.error).toMatchObject({ type: 'ConversationCleared' });
    expect(assistant.error).toBeUndefined();
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'interrupted',
      expect.objectContaining({ type: 'ConversationCleared' }),
      expect.anything(),
    );
  });
});

describe('executeConversationGeneration dangling assistant pointer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.insertEvent.mockResolvedValue({ id: 1 });
    modelMocks.isSupersededByLaneGeneration.mockResolvedValue(false);
    modelMocks.touchHeartbeat.mockResolvedValue({ status: 'processing' });
    modelMocks.finalizeActive.mockImplementation(async (id, status) => ({
      id,
      revision: 5,
      status,
    }));
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({
      messages: [{ content: 'hi', id: 'user-1', role: 'user' }],
      topics: [],
    });
    runtimeMocks.chat.mockResolvedValue(new Response());
    vi.mocked(consumeProtocolResponse).mockReset();
    vi.mocked(consumeProtocolResponse).mockResolvedValue({ content: 'recovered answer' });
  });

  it('recreates a missing owned assistant and stores the recovered response', async () => {
    const ghost = {
      content: LOADING_FLAT,
      id: 'ghost-asst',
      metadata: {} as Record<string, unknown>,
      role: 'assistant',
    };
    let created = false;
    const row = {
      assistantMessageId: ghost.id,
      attempt: 1,
      config: { model: 'test-model', provider: 'test-provider' },
      id: 'cgo_ghost',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    messageMocks.findById.mockImplementation(async (id) =>
      id === ghost.id && created ? ghost : undefined,
    );
    messageMocks.create.mockImplementation(async (params, id) => {
      created = true;
      ghost.content = params.content;
      return { ...ghost, id, content: params.content };
    });
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === ghost.id) Object.assign(ghost, value);
    });
    messageMocks.updateMetadata.mockImplementation(async (id, value) => {
      if (id === ghost.id) ghost.metadata = { ...ghost.metadata, ...value };
    });

    await runOperation(row);

    expect(messageMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: LOADING_FLAT, role: 'assistant' }),
      'ghost-asst',
    );
    expect(ghost.content).toBe('recovered answer');
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'succeeded',
      undefined,
      expect.anything(),
    );
  });

  it('refuses to mark success when the assistant row is missing after generation', async () => {
    const ghost = {
      content: LOADING_FLAT,
      id: 'ghost-asst',
      metadata: {} as Record<string, unknown>,
      role: 'assistant',
    };
    let created = false;
    let vanished = false;
    const row = {
      assistantMessageId: ghost.id,
      attempt: 8,
      config: { model: 'test-model', provider: 'test-provider' },
      id: 'cgo_ghost_missing',
      kind: 'chat',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    messageMocks.findById.mockImplementation(async (id) => {
      if (id !== ghost.id || vanished || !created) return undefined;
      return ghost;
    });
    messageMocks.create.mockImplementation(async (params, id) => {
      created = true;
      ghost.content = params.content;
      return { ...ghost, id, content: params.content };
    });
    messageMocks.update.mockResolvedValue(undefined);
    messageMocks.updateMetadata.mockResolvedValue(undefined);
    vi.mocked(consumeProtocolResponse).mockImplementation(async () => {
      vanished = true;
      return { content: 'secret answer' };
    });

    await runOperation(row);

    expect(modelMocks.finalizeActive).not.toHaveBeenCalledWith(
      row.id,
      'succeeded',
      expect.anything(),
      expect.anything(),
    );
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      row.id,
      'failed',
      expect.objectContaining({
        message: 'Assistant message is missing after generation.',
      }),
      expect.anything(),
    );
  });
});

describe('titleTranscriptRetryDelayMs', () => {
  it('backs off in seconds, not Graphile milliseconds', () => {
    expect(titleTranscriptRetryDelayMs(1)).toBe(1000);
    expect(titleTranscriptRetryDelayMs(2)).toBe(2000);
    expect(titleTranscriptRetryDelayMs(3)).toBe(4000);
    expect(titleTranscriptRetryDelayMs(8)).toBe(8000);
  });
});
