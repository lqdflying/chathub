/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  executeConversationGeneration,
  getSupervisorTerminalOutcome,
  shouldCreateToolContinuation,
  shouldGenerateConversationTitle,
} from './execute';

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

vi.mock('@/database/models/agent', () => ({ AgentModel: class {} }));
vi.mock('@/database/models/chatGroup', () => ({ ChatGroupModel: class {} }));
vi.mock('@/database/models/message', () => ({ MessageModel: class {} }));
vi.mock('@/database/models/topic', () => ({ TopicModel: class {} }));
vi.mock('@/database/models/user', () => ({ UserModel: { findById: vi.fn() } }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: class {} }));
vi.mock('@/server/services/aiChat', () => ({ AiChatService: class {} }));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeWithUserPayload: vi.fn(),
}));
vi.mock('./credentials', () => ({
  loadConversationRuntimeState: vi.fn(),
  resolveConversationRuntimePayload: vi.fn(),
}));
vi.mock('./payload', () => ({
  buildConversationChatPayload: vi.fn(),
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
});
