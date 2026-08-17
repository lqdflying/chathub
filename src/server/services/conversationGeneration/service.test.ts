/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const modelMocks = vi.hoisted(() => ({
  finalizeActive: vi.fn(),
  insertEvent: vi.fn(),
  listStaleCancelling: vi.fn(),
  listStaleProcessing: vi.fn(),
  requeueStaleProcessing: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/database/models/conversationGeneration', () => ({
  ConversationGenerationModel: class {
    finalizeActive = modelMocks.finalizeActive;
    insertEvent = modelMocks.insertEvent;
    listStaleCancelling = modelMocks.listStaleCancelling;
    listStaleProcessing = modelMocks.listStaleProcessing;
    requeueStaleProcessing = modelMocks.requeueStaleProcessing;
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

vi.mock('graphile-worker', () => ({
  makeWorkerUtils: vi.fn(),
}));

import { sweepStaleConversationGenerationOperations } from './service';

describe('sweepStaleConversationGenerationOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.listStaleCancelling.mockResolvedValue([]);
    modelMocks.listStaleProcessing.mockResolvedValue([]);
    modelMocks.insertEvent.mockResolvedValue({ id: 1 });
    modelMocks.update.mockResolvedValue({ id: 'operation-1' });
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
      workerJobId: operation.id,
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

    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      operation.id,
      'cancelled',
      undefined,
      { attempt: 1, laneGeneration: 1 },
    );
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
