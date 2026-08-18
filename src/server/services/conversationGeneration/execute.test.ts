/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@lobechat/const';
import { UserModel } from '@/database/models/user';
import {
  CONVERSATION_GENERATION_TURN_COMPLETE,
  excludeOwnedAssistantMessages,
  executeConversationGeneration,
  getSupervisorTerminalOutcome,
  resolveChatResumeAction,
  shouldCreateToolContinuation,
  shouldGenerateConversationTitle,
} from './execute';
import { consumeProtocolResponse } from './stream';
import { executeConversationToolStep } from './tools';

const modelMocks = vi.hoisted(() => ({
  bumpRevision: vi.fn(),
  claimForProcessing: vi.fn(),
  finalizeActive: vi.fn(),
  findById: vi.fn(),
  insertEvent: vi.fn(),
  isSupersededByLaneGeneration: vi.fn(),
  markForRetry: vi.fn(),
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

const runtimeMocks = vi.hoisted(() => ({
  chat: vi.fn(),
  generateObject: vi.fn(),
}));

vi.mock('@/database/models/conversationGeneration', () => ({
  ConversationGenerationModel: class {
    bumpRevision = modelMocks.bumpRevision;
    claimForProcessing = modelMocks.claimForProcessing;
    finalizeActive = modelMocks.finalizeActive;
    findById = modelMocks.findById;
    insertEvent = modelMocks.insertEvent;
    isSupersededByLaneGeneration = modelMocks.isSupersededByLaneGeneration;
    markForRetry = modelMocks.markForRetry;
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
vi.mock('@/database/models/thread', () => ({ ThreadModel: class { findById = vi.fn(); } }));
vi.mock('@/database/models/topic', () => ({ TopicModel: class {} }));
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
  resolveConversationRuntimePayload: vi.fn().mockResolvedValue({}),
}));
vi.mock('./payload', () => ({
  buildConversationChatPayload: vi.fn().mockResolvedValue({ payload: { messages: [] } }),
}));
vi.mock('./stream', () => ({
  consumeProtocolResponse: vi.fn(),
}));
vi.mock('./tools', () => ({
  executeConversationToolStep: vi.fn(),
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
    expect(resolveChatResumeAction({ content: 'checkpointed partial', tools: [] })).toBe('generate');
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
    modelMocks.update.mockResolvedValue({ revision: 1, status: 'cancelled' });
    modelMocks.bumpRevision.mockResolvedValue({ revision: 1, status: 'cancelled' });
    modelMocks.finalizeActive.mockResolvedValue({ revision: 1, status: 'cancelled' });
    modelMocks.insertEvent.mockResolvedValue({ id: 1 });
    modelMocks.isSupersededByLaneGeneration.mockResolvedValue(false);
    modelMocks.touchHeartbeat.mockResolvedValue({ status: 'processing' });
    aiChatMocks.getMessagesAndTopics.mockResolvedValue({ messages: [], topics: [] });
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
    messageMocks.findById.mockImplementation(async (id) =>
      id === child.id ? child : undefined,
    );
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
    modelMocks.findById.mockResolvedValueOnce(pending).mockResolvedValueOnce(processing);
    modelMocks.claimForProcessing.mockResolvedValue(processing);
    modelMocks.markForRetry.mockResolvedValue({
      ...processing,
      revision: 2,
      status: 'pending',
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
    modelMocks.findById.mockResolvedValueOnce(pending).mockResolvedValueOnce(processing);
    modelMocks.claimForProcessing.mockResolvedValue(processing);
    modelMocks.finalizeActive.mockResolvedValue({
      ...processing,
      revision: 2,
      status: 'failed',
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
    modelMocks.bumpRevision.mockResolvedValue({ ...row, revision: 3, status: 'processing' });
    modelMocks.finalizeActive.mockImplementation(async (id, status, error) => ({
      error,
      id,
      revision: 9,
      status,
    }));
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

  it('records a child id before inserting the placeholder row', async () => {
    const order: string[] = [];
    modelMocks.update.mockImplementation(async (_id, value) => {
      if (value.config?.supervisorChildMessageIds?.length) {
        order.push(`persist:${value.config.supervisorChildMessageIds.join(',')}`);
      }
      Object.assign(row, value);
      if (value.config) row.config = value.config;
      return { ...row, revision: 2, status: 'processing' };
    });
    messageMocks.create.mockImplementation(async (params, id) => {
      order.push(`create:${id}`);
      const created = { content: params.content, id };
      children.push(created);
      return created;
    });

    await runOperation(row, { preserveUpdate: true });

    expect(order[0]).toMatch(/^persist:/);
    expect(order[1]).toMatch(/^create:/);
    expect(order[0]?.slice('persist:'.length)).toBe(order[1]?.slice('create:'.length));
  });

  it('does not insert a child row when id persistence fails', async () => {
    modelMocks.update.mockImplementation(async (_id, value) => {
      if (value.config?.supervisorChildMessageIds?.length) {
        throw new Error('config persist failed');
      }
      Object.assign(row, value);
      return { ...row, revision: 2, status: 'processing' };
    });

    await expect(runOperation(row, { preserveUpdate: true })).rejects.toThrow(
      'config persist failed',
    );
    expect(messageMocks.create).not.toHaveBeenCalled();
    expect(children).toEqual([]);
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
    runtimeMocks.chat.mockResolvedValue(new Response());
    vi.mocked(executeConversationToolStep).mockResolvedValue({
      content: 'tool result',
      inputHash: 'hash-1',
      messageId: 'tool-1',
      shouldContinue: true,
      success: true,
    });
  });

  it('persists the next assistant id before creating the continuation placeholder', async () => {
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

    expect(order[0]).toMatch(/^persist:/);
    expect(order[1]).toMatch(/^create:/);
    expect(order[0]?.slice('persist:'.length)).toBe(order[1]?.slice('create:'.length));
  });

  it('does not insert a continuation row when id persistence fails', async () => {
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
    vi.mocked(consumeProtocolResponse).mockResolvedValue({
      content: 'calling tool',
      toolCalls: [{ function: { arguments: '{}', name: 'plugin____search' }, id: 'call-1' }],
    });

    await expect(runOperation(row, { preserveUpdate: true })).rejects.toThrow(
      'assistant id persist failed',
    );
    expect(messageMocks.create).not.toHaveBeenCalled();
  });
});
