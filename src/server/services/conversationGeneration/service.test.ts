/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConversationGenerationService,
  sweepStaleConversationGenerationOperations,
} from './service';

const modelMocks = vi.hoisted(() => ({
  create: vi.fn(),
  finalizeActive: vi.fn(),
  findActiveByLane: vi.fn(),
  findByIdempotencyKey: vi.fn(),
  findMaxLaneGeneration: vi.fn(),
  insertEvent: vi.fn(),
  listStaleCancelling: vi.fn(),
  listStaleProcessing: vi.fn(),
  requeueStaleProcessing: vi.fn(),
  requestCancel: vi.fn(),
  update: vi.fn(),
}));

const graphileMocks = vi.hoisted(() => ({
  makeWorkerUtils: vi.fn(),
}));
const toolMocks = vi.hoisted(() => ({
  findUnsupportedConversationTool: vi.fn(),
}));

vi.mock('@/database/models/conversationGeneration', () => ({
  ConversationGenerationModel: class {
    create = modelMocks.create;
    finalizeActive = modelMocks.finalizeActive;
    findActiveByLane = modelMocks.findActiveByLane;
    findByIdempotencyKey = modelMocks.findByIdempotencyKey;
    findMaxLaneGeneration = modelMocks.findMaxLaneGeneration;
    insertEvent = modelMocks.insertEvent;
    listStaleCancelling = modelMocks.listStaleCancelling;
    listStaleProcessing = modelMocks.listStaleProcessing;
    requeueStaleProcessing = modelMocks.requeueStaleProcessing;
    requestCancel = modelMocks.requestCancel;
    update = modelMocks.update;
  },
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: class {},
}));

vi.mock('@/server/services/conversationWriteLock', () => ({
  withConversationWriteLockOrThrow: vi.fn(),
}));

vi.mock('./credentials', () => ({
  resolveConversationRuntimePayload: vi.fn(),
}));
vi.mock('./tools', () => ({
  findUnsupportedConversationTool: toolMocks.findUnsupportedConversationTool,
}));

vi.mock('graphile-worker', () => ({
  makeWorkerUtils: graphileMocks.makeWorkerUtils,
}));

describe('sweepStaleConversationGenerationOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.listStaleCancelling.mockResolvedValue([]);
    modelMocks.listStaleProcessing.mockResolvedValue([]);
    modelMocks.insertEvent.mockResolvedValue({ id: 1 });
    modelMocks.update.mockResolvedValue({ id: 'operation-1' });
    modelMocks.findActiveByLane.mockResolvedValue(undefined);
    modelMocks.findByIdempotencyKey.mockResolvedValue(undefined);
    modelMocks.findMaxLaneGeneration.mockResolvedValue(0);
    toolMocks.findUnsupportedConversationTool.mockResolvedValue(undefined);
  });

  it('atomically returns stale processing attempts to pending and re-enqueues them', async () => {
    const operation = {
      attempt: 2,
      id: 'operation-1',
      laneGeneration: 3,
      revision: 4,
      userId: 'user-1',
    };
    const db = { execute: vi.fn().mockResolvedValue([]) };
    modelMocks.listStaleProcessing.mockResolvedValue([operation]);
    modelMocks.requeueStaleProcessing.mockResolvedValue({
      ...operation,
      revision: 5,
      status: 'pending',
    });

    await sweepStaleConversationGenerationOperations(db as any);

    expect(modelMocks.requeueStaleProcessing).toHaveBeenCalledWith(
      operation.id,
      expect.any(Date),
      expect.objectContaining({ type: 'StaleProcessing' }),
    );
    expect(modelMocks.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: operation.id,
        payload: expect.objectContaining({ status: 'pending' }),
        revision: 5,
        type: 'status',
      }),
    );
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(modelMocks.update).toHaveBeenCalledWith(operation.id, {
      workerJobId: `${operation.id}:recovery:5`,
    });
  });

  it('finalizes a stale cancelling operation without re-enqueueing it', async () => {
    const operation = {
      attempt: 1,
      id: 'operation-cancelling',
      laneGeneration: 1,
      revision: 2,
      userId: 'user-1',
    };
    const db = { execute: vi.fn() };
    modelMocks.listStaleCancelling.mockResolvedValue([operation]);
    modelMocks.finalizeActive.mockResolvedValue({
      ...operation,
      revision: 3,
      status: 'cancelled',
    });

    await sweepStaleConversationGenerationOperations(db as any);

    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(operation.id, 'cancelled', undefined, {
      attempt: 1,
      laneGeneration: 1,
    });
    expect(modelMocks.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: operation.id,
        revision: 3,
        type: 'done',
      }),
    );
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('fails a stale operation that exhausted its retry budget', async () => {
    const operation = {
      attempt: 8,
      id: 'operation-final-attempt',
      laneGeneration: 1,
      revision: 7,
      userId: 'user-1',
    };
    const db = { execute: vi.fn() };
    modelMocks.listStaleProcessing.mockResolvedValue([operation]);
    modelMocks.finalizeActive.mockResolvedValue({
      ...operation,
      revision: 8,
      status: 'failed',
    });

    await sweepStaleConversationGenerationOperations(db as any);

    expect(modelMocks.requeueStaleProcessing).not.toHaveBeenCalled();
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      operation.id,
      'failed',
      expect.objectContaining({ type: 'StaleProcessing' }),
      { attempt: 8, laneGeneration: 1 },
    );
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('ConversationGenerationService.enqueueInTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.findActiveByLane.mockResolvedValue(undefined);
    modelMocks.findByIdempotencyKey.mockResolvedValue(undefined);
    modelMocks.findMaxLaneGeneration.mockResolvedValue(0);
    modelMocks.update.mockImplementation(async (id, value) => ({ id, ...value }));
  });

  const input = {
    config: { model: 'model-1', provider: 'provider-1', title: { topicId: 'topic-1' } },
    idempotencyKey: 'request-key-123',
    kind: 'topic_title' as const,
    sessionId: 'session-1',
    topicId: 'topic-1',
  };

  it('returns the existing operation from the locked transaction before writing', async () => {
    const existing = {
      ...input,
      id: 'operation-existing',
      lane: 'user-1:session:session-1:topic-1:main',
      laneGeneration: 1,
      status: 'processing',
      userId: 'user-1',
    };
    const db = { execute: vi.fn() };
    modelMocks.findByIdempotencyKey.mockResolvedValue(existing);

    const result = await new ConversationGenerationService(
      db as any,
      'user-1',
    ).enqueueInTransaction(db as any, input);

    expect(result).toBe(existing);
    expect(modelMocks.create).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('lets a transactional Graphile enqueue failure roll back without opening a fallback connection', async () => {
    const db = { execute: vi.fn().mockRejectedValue(new Error('transaction aborted')) };
    modelMocks.create.mockResolvedValue({
      ...input,
      attempt: 0,
      id: 'operation-new',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    });

    await expect(
      new ConversationGenerationService(db as any, 'user-1').enqueueInTransaction(db as any, input),
    ).rejects.toThrow('transaction aborted');

    expect(graphileMocks.makeWorkerUtils).not.toHaveBeenCalled();
    expect(modelMocks.update).not.toHaveBeenCalled();
  });

  it('records the real Graphile job id before the transaction completes', async () => {
    const db = { execute: vi.fn().mockResolvedValue([{ workerJobId: '42' }]) };
    modelMocks.create.mockResolvedValue({
      ...input,
      attempt: 0,
      id: 'operation-new',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    });

    const result = await new ConversationGenerationService(
      db as any,
      'user-1',
    ).enqueueInTransaction(db as any, input);

    expect(modelMocks.update).toHaveBeenCalledWith('operation-new', { workerJobId: '42' });
    expect(result).toMatchObject({ id: 'operation-new', workerJobId: '42' });
  });
});
