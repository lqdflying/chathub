/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConversationGenerationService,
  sweepPendingConversationGenerationJobs,
  sweepStaleConversationGenerationOperations,
} from './service';

const modelMocks = vi.hoisted(() => ({
  create: vi.fn(),
  finalizeActive: vi.fn(),
  findActiveByLane: vi.fn(),
  findById: vi.fn(),
  findByIdempotencyKey: vi.fn(),
  findMaxLaneGeneration: vi.fn(),
  insertEvent: vi.fn(),
  latestEventId: vi.fn(),
  listEventsAfter: vi.fn(),
  listPendingWithoutJob: vi.fn(),
  listStaleCancelling: vi.fn(),
  listStaleProcessing: vi.fn(),
  requestCancel: vi.fn(),
  requeueStaleProcessing: vi.fn(),
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
    findById = modelMocks.findById;
    findByIdempotencyKey = modelMocks.findByIdempotencyKey;
    findMaxLaneGeneration = modelMocks.findMaxLaneGeneration;
    insertEvent = modelMocks.insertEvent;
    latestEventId = modelMocks.latestEventId;
    listEventsAfter = modelMocks.listEventsAfter;
    listPendingWithoutJob = modelMocks.listPendingWithoutJob;
    listStaleCancelling = modelMocks.listStaleCancelling;
    listStaleProcessing = modelMocks.listStaleProcessing;
    requestCancel = modelMocks.requestCancel;
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
    modelMocks.listPendingWithoutJob.mockResolvedValue([]);
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
    modelMocks.listPendingWithoutJob.mockResolvedValue([]);
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
      lane: 'user-1:session:session-1:topic-1:main:topic_title',
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

  it('returns a terminal operation for the same request key', async () => {
    const existing = {
      ...input,
      id: 'operation-succeeded',
      lane: 'user-1:session:session-1:topic-1:main:topic_title',
      laneGeneration: 1,
      status: 'succeeded',
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
  });

  it('creates a new operation when a later action uses a different request key', async () => {
    const db = { execute: vi.fn().mockResolvedValue([{ workerJobId: '99' }]) };
    modelMocks.findByIdempotencyKey.mockResolvedValue(undefined);
    modelMocks.create.mockResolvedValue({
      ...input,
      id: 'operation-later',
      idempotencyKey: 'topic-title:topic-1:req-laterxxxxxxxx',
      lane: 'lane-1',
      laneGeneration: 2,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    });

    await new ConversationGenerationService(db as any, 'user-1').enqueueInTransaction(db as any, {
      ...input,
      idempotencyKey: 'topic-title:topic-1:req-laterxxxxxxxx',
    });

    expect(modelMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'topic-title:topic-1:req-laterxxxxxxxx',
      }),
    );
    expect(db.execute).toHaveBeenCalled();
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

  it('cancels and advances the lane generation when replacement is requested', async () => {
    const db = { execute: vi.fn().mockResolvedValue([{ workerJobId: '43' }]) };
    modelMocks.findActiveByLane.mockResolvedValue({
      id: 'operation-active',
      laneGeneration: 4,
      status: 'processing',
    });
    modelMocks.findMaxLaneGeneration.mockResolvedValue(4);
    modelMocks.create.mockImplementation(async (value) => ({
      ...value,
      attempt: 0,
      id: 'operation-replacement',
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    }));

    const result = await new ConversationGenerationService(
      db as any,
      'user-1',
    ).enqueueInTransaction(db as any, { ...input, replaceActive: true });

    expect(modelMocks.requestCancel).toHaveBeenCalledWith('operation-active');
    expect(modelMocks.findMaxLaneGeneration).toHaveBeenCalled();
    expect(modelMocks.create).toHaveBeenCalledWith(expect.objectContaining({ laneGeneration: 5 }));
    expect(result).toMatchObject({ id: 'operation-replacement', workerJobId: '43' });
  });

  it('does not treat a cancelling predecessor as a blocking lane occupant', async () => {
    const db = { execute: vi.fn().mockResolvedValue([{ workerJobId: '44' }]) };
    modelMocks.findActiveByLane.mockResolvedValue(undefined);
    modelMocks.findMaxLaneGeneration.mockResolvedValue(6);
    modelMocks.create.mockImplementation(async (value) => ({
      ...value,
      attempt: 0,
      id: 'operation-after-cancel',
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    }));

    const result = await new ConversationGenerationService(
      db as any,
      'user-1',
    ).enqueueInTransaction(db as any, { ...input, replaceActive: true });

    expect(modelMocks.requestCancel).not.toHaveBeenCalled();
    expect(modelMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'topic_title',
        lane: 'user-1:session:session-1:topic-1:main:topic_title',
        laneGeneration: 7,
      }),
    );
    expect(result).toMatchObject({ id: 'operation-after-cancel', workerJobId: '44' });
  });

  it('rejects reuse of an idempotency key for a different request', async () => {
    modelMocks.findByIdempotencyKey.mockResolvedValue({
      config: { model: 'different-model', provider: 'provider-1' },
      id: 'operation-existing',
      kind: 'topic_title',
      lane: 'user-1:session:session-1:topic-1:main:topic_title',
    });

    await expect(
      new ConversationGenerationService({} as any, 'user-1').enqueueInTransaction({} as any, input),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(modelMocks.create).not.toHaveBeenCalled();
  });
});

describe('ConversationGenerationService cancellation and event cursors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.insertEvent.mockResolvedValue({ id: 1 });
  });

  it('finalizes a pending cancellation immediately and emits done', async () => {
    const pending = {
      attempt: 0,
      id: 'operation-pending',
      laneGeneration: 2,
      revision: 0,
      status: 'pending',
    };
    modelMocks.findById.mockResolvedValue(pending);
    modelMocks.requestCancel.mockResolvedValue({ ...pending, status: 'cancelling' });
    modelMocks.finalizeActive.mockResolvedValue({
      ...pending,
      revision: 1,
      status: 'cancelled',
    });

    const result = await new ConversationGenerationService({} as any, 'user-1').cancel(pending.id);

    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(pending.id, 'cancelled', undefined, {
      attempt: 0,
      laneGeneration: 2,
    });
    expect(modelMocks.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'done' }));
    expect(result).toMatchObject({ status: 'cancelled' });
  });

  it('resets an event cursor that is ahead of the retained stream', async () => {
    modelMocks.latestEventId.mockResolvedValue(10);

    await expect(
      new ConversationGenerationService({} as any, 'user-1').listEvents(11),
    ).resolves.toEqual({ cursor: 0, events: [], reset: true });
    expect(modelMocks.listEventsAfter).not.toHaveBeenCalled();
  });
});

describe('sweepPendingConversationGenerationJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.update.mockResolvedValue({ id: 'operation-pending' });
  });

  it('re-enqueues pending operations that lost their worker job id', async () => {
    modelMocks.listPendingWithoutJob.mockResolvedValue([
      { id: 'operation-pending', userId: 'user-1' },
    ]);
    const db = { execute: vi.fn().mockResolvedValue([{ workerJobId: '44' }]) };

    await sweepPendingConversationGenerationJobs(db as any);

    expect(db.execute).toHaveBeenCalledOnce();
    expect(modelMocks.update).toHaveBeenCalledWith('operation-pending', {
      workerJobId: '44',
    });
  });
});
