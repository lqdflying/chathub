/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  invokeConversationTool: vi.fn(),
}));

import { executeConversationGeneration } from './execute';

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
      .mockResolvedValueOnce(processing);
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
    modelMocks.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(processing);
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
