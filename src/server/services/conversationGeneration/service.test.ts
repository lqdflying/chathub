/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@lobechat/const';

import { CONVERSATION_GENERATION_CLEANUP_PAGE_SIZE } from './constants';
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
  listUncleanedFinished: vi.fn(),
  markPlaceholdersCleaned: vi.fn(),
  requestCancel: vi.fn(),
  requeueStaleProcessing: vi.fn(),
  update: vi.fn(),
}));

const messageMocks = vi.hoisted(() => ({
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
}));

const graphileMocks = vi.hoisted(() => ({
  makeWorkerUtils: vi.fn(),
}));
const toolMocks = vi.hoisted(() => ({
  findUnsupportedConversationTool: vi.fn(),
}));

const bindDbMethod = vi.hoisted(
  () =>
    (fn: (...args: any[]) => unknown) =>
    async function (
      this: { db?: { ensureActive?: () => void; fail?: () => void } },
      ...args: any[]
    ) {
      this.db?.ensureActive?.();
      try {
        return await fn(...args);
      } catch (error) {
        this.db?.fail?.();
        throw error;
      }
    },
);

vi.mock('@/database/models/conversationGeneration', () => ({
  ConversationGenerationModel: class {
    constructor(db?: { ensureActive?: () => void; fail?: () => void }) {
      this.db = db;
    }
    db?: { ensureActive?: () => void; fail?: () => void };
    create = bindDbMethod(modelMocks.create);
    finalizeActive = bindDbMethod(modelMocks.finalizeActive);
    findActiveByLane = bindDbMethod(modelMocks.findActiveByLane);
    findById = bindDbMethod(modelMocks.findById);
    findByIdempotencyKey = bindDbMethod(modelMocks.findByIdempotencyKey);
    findMaxLaneGeneration = bindDbMethod(modelMocks.findMaxLaneGeneration);
    insertEvent = bindDbMethod(modelMocks.insertEvent);
    latestEventId = bindDbMethod(modelMocks.latestEventId);
    listEventsAfter = bindDbMethod(modelMocks.listEventsAfter);
    listPendingWithoutJob = bindDbMethod(modelMocks.listPendingWithoutJob);
    listStaleCancelling = bindDbMethod(modelMocks.listStaleCancelling);
    listStaleProcessing = bindDbMethod(modelMocks.listStaleProcessing);
    listUncleanedFinished = bindDbMethod(modelMocks.listUncleanedFinished);
    markPlaceholdersCleaned = bindDbMethod(modelMocks.markPlaceholdersCleaned);
    requestCancel = bindDbMethod(modelMocks.requestCancel);
    requeueStaleProcessing = bindDbMethod(modelMocks.requeueStaleProcessing);
    update = bindDbMethod(modelMocks.update);
  },
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    constructor(db?: { ensureActive?: () => void; fail?: () => void }) {
      this.db = db;
    }
    db?: { ensureActive?: () => void; fail?: () => void };
    create = bindDbMethod(messageMocks.create);
    findById = bindDbMethod(messageMocks.findById);
    update = bindDbMethod(messageMocks.update);
  },
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
    modelMocks.listUncleanedFinished.mockResolvedValue([]);
    modelMocks.markPlaceholdersCleaned.mockResolvedValue({});
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

  it('clears tracked child placeholders when a stale cancelling operation is finalized', async () => {
    const child = { content: LOADING_FLAT, id: 'child-stale-cancel' };
    const operation = {
      attempt: 1,
      config: {
        model: 'test-model',
        provider: 'test-provider',
        supervisorChildMessageIds: [child.id],
      },
      id: 'operation-cancelling-children',
      laneGeneration: 1,
      revision: 2,
      userId: 'user-1',
    };
    modelMocks.listStaleCancelling.mockResolvedValue([operation]);
    modelMocks.finalizeActive.mockResolvedValue({
      ...operation,
      revision: 3,
      status: 'cancelled',
    });
    messageMocks.findById.mockImplementation(async (id) => (id === child.id ? child : undefined));
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === child.id) Object.assign(child, value);
    });

    await sweepStaleConversationGenerationOperations({ execute: vi.fn() } as any);

    expect(child.content).toBe('');
  });

  it('clears tracked child placeholders when a final-attempt stale operation fails', async () => {
    const child = { content: LOADING_FLAT, id: 'child-stale-fail' };
    const operation = {
      attempt: 8,
      config: {
        model: 'test-model',
        provider: 'test-provider',
        supervisorChildMessageIds: [child.id],
      },
      id: 'operation-final-attempt-children',
      laneGeneration: 1,
      revision: 7,
      userId: 'user-1',
    };
    modelMocks.listStaleProcessing.mockResolvedValue([operation]);
    modelMocks.finalizeActive.mockResolvedValue({
      ...operation,
      revision: 8,
      status: 'failed',
    });
    messageMocks.findById.mockImplementation(async (id) => (id === child.id ? child : undefined));
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === child.id) Object.assign(child, value);
    });

    await sweepStaleConversationGenerationOperations({ execute: vi.fn() } as any);

    expect(child.content).toBe('');
    expect(modelMocks.requeueStaleProcessing).not.toHaveBeenCalled();
  });

  it('clears leftover loading rows on unmarked finished operations after a crash', async () => {
    const pendingCancelChild = { content: LOADING_FLAT, id: 'child-pending-crash' };
    const staleFailChild = { content: LOADING_FLAT, id: 'child-stale-crash' };
    const rows: Record<string, { content: string; id: string }> = {
      [pendingCancelChild.id]: pendingCancelChild,
      [staleFailChild.id]: staleFailChild,
    };
    modelMocks.listUncleanedFinished.mockResolvedValueOnce([
      {
        assistantMessageId: null,
        config: {
          model: 'test-model',
          provider: 'test-provider',
          supervisorChildMessageIds: [pendingCancelChild.id],
        },
        finishedAt: new Date(),
        id: 'operation-pending-cancel-crash',
        status: 'cancelled',
        userId: 'user-1',
      },
      {
        assistantMessageId: null,
        config: {
          model: 'test-model',
          provider: 'test-provider',
          supervisorChildMessageIds: [staleFailChild.id],
        },
        finishedAt: new Date(),
        id: 'operation-stale-fail-crash',
        status: 'failed',
        userId: 'user-1',
      },
    ]);
    messageMocks.findById.mockImplementation(async (id) => rows[id]);
    messageMocks.update.mockImplementation(async (id, value) => {
      if (rows[id]) Object.assign(rows[id], value);
    });

    await sweepStaleConversationGenerationOperations({ execute: vi.fn() } as any);

    expect(modelMocks.finalizeActive).not.toHaveBeenCalled();
    expect(pendingCancelChild.content).toBe('');
    expect(staleFailChild.content).toBe('');
    expect(modelMocks.markPlaceholdersCleaned).toHaveBeenCalledWith(
      'operation-pending-cancel-crash',
    );
    expect(modelMocks.markPlaceholdersCleaned).toHaveBeenCalledWith('operation-stale-fail-crash');
  });

  it('pages through unmarked terminal jobs so the oldest leftover is still cleared', async () => {
    const leftover = { content: LOADING_FLAT, id: 'oldest-child' };
    const oldestFinishedAt = new Date('2026-01-01T00:00:00.000Z');
    const tiedFinishedAt = new Date('2026-06-01T00:00:00.000Z');
    const newestFinishedAt = new Date('2026-08-01T00:00:00.000Z');
    const oldest = {
      assistantMessageId: null,
      config: {
        model: 'test-model',
        provider: 'test-provider',
        supervisorChildMessageIds: [leftover.id],
      },
      finishedAt: oldestFinishedAt,
      id: 'operation-oldest',
      status: 'failed',
      userId: 'user-1',
    };
    const tied = Array.from({ length: 2 }, (_, index) => ({
      assistantMessageId: null,
      config: { model: 'test-model', provider: 'test-provider' },
      finishedAt: tiedFinishedAt,
      id: `operation-tied-${index}`,
      status: 'succeeded',
      userId: 'user-1',
    }));
    const newer = Array.from({ length: CONVERSATION_GENERATION_CLEANUP_PAGE_SIZE - 1 }, (_, index) => ({
      assistantMessageId: null,
      config: { model: 'test-model', provider: 'test-provider' },
      finishedAt: new Date(newestFinishedAt.getTime() + index),
      id: `operation-new-${String(index).padStart(3, '0')}`,
      status: 'succeeded',
      userId: 'user-1',
    }));
    const all = [oldest, ...tied, ...newer].sort((left, right) => {
      const time = left.finishedAt.getTime() - right.finishedAt.getTime();
      if (time !== 0) return time;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
    expect(all).toHaveLength(CONVERSATION_GENERATION_CLEANUP_PAGE_SIZE + 2);

    modelMocks.listUncleanedFinished.mockImplementation(async ({ after, limit = 100 } = {}) => {
      const start = after
        ? all.findIndex(
            (row) =>
              row.finishedAt.getTime() > after.finishedAt.getTime() ||
              (row.finishedAt.getTime() === after.finishedAt.getTime() && row.id > after.id),
          )
        : 0;
      const from = start < 0 ? all.length : start;
      return all.slice(from, from + limit);
    });
    modelMocks.findById.mockImplementation(async (id) => all.find((row) => row.id === id));
    messageMocks.findById.mockImplementation(async (id) => (id === leftover.id ? leftover : undefined));
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === leftover.id) Object.assign(leftover, value);
    });

    await sweepStaleConversationGenerationOperations({ execute: vi.fn() } as any);

    expect(modelMocks.listUncleanedFinished.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(modelMocks.listUncleanedFinished.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ after: undefined, limit: CONVERSATION_GENERATION_CLEANUP_PAGE_SIZE }),
    );
    expect(modelMocks.listUncleanedFinished.mock.calls[1]?.[0]?.after).toEqual({
      finishedAt: all[CONVERSATION_GENERATION_CLEANUP_PAGE_SIZE - 1]?.finishedAt,
      id: all[CONVERSATION_GENERATION_CLEANUP_PAGE_SIZE - 1]?.id,
    });
    expect(leftover.content).toBe('');
    expect(modelMocks.markPlaceholdersCleaned).toHaveBeenCalledWith('operation-oldest');
    expect(modelMocks.markPlaceholdersCleaned).toHaveBeenCalledTimes(all.length);
  });

  const ABORTED_TRANSACTION_MESSAGE =
    'current transaction is aborted, commands ignored until end of transaction block';

  type AbortAwareHandle = {
    aborted: boolean;
    ensureActive: () => void;
    fail: () => void;
    transaction: <T>(callback: (trx: AbortAwareHandle) => Promise<T>) => Promise<T>;
  };

  const createAbortAwareHandle = (parent?: AbortAwareHandle): AbortAwareHandle => {
    const handle: AbortAwareHandle = {
      aborted: false,
      ensureActive() {
        if (handle.aborted || parent?.aborted) {
          throw new Error(ABORTED_TRANSACTION_MESSAGE);
        }
      },
      fail() {
        handle.aborted = true;
      },
      async transaction(callback) {
        handle.ensureActive();
        const nested = createAbortAwareHandle(handle);
        try {
          const result = await callback(nested);
          if (nested.aborted) {
            throw new Error(ABORTED_TRANSACTION_MESSAGE);
          }
          return result;
        } catch (error) {
          nested.aborted = true;
          throw error;
        }
      },
    };
    return handle;
  };

  const createPoisonSweepRows = () => {
    const leftover = { content: LOADING_FLAT, id: 'later-child' };
    const poisonChild = { content: LOADING_FLAT, id: 'poison-child' };
    const oldestFinishedAt = new Date('2026-01-01T00:00:00.000Z');
    const newerFinishedAt = new Date('2026-08-01T00:00:00.000Z');
    const oldest = {
      assistantMessageId: null,
      config: {
        model: 'test-model',
        provider: 'test-provider',
        supervisorChildMessageIds: [poisonChild.id],
      },
      finishedAt: oldestFinishedAt,
      id: 'operation-oldest',
      status: 'failed',
      userId: 'user-1',
    };
    const newer = Array.from({ length: CONVERSATION_GENERATION_CLEANUP_PAGE_SIZE }, (_, index) => ({
      assistantMessageId: null,
      config:
        index === CONVERSATION_GENERATION_CLEANUP_PAGE_SIZE - 1
          ? {
              model: 'test-model',
              provider: 'test-provider',
              supervisorChildMessageIds: [leftover.id],
            }
          : { model: 'test-model', provider: 'test-provider' },
      finishedAt: new Date(newerFinishedAt.getTime() + index),
      id: `operation-new-${String(index).padStart(3, '0')}`,
      status: 'succeeded',
      userId: 'user-1',
    }));
    const all = [oldest, ...newer];
    return { all, laterId: newer.at(-1)?.id, leftover, oldest, poisonChild };
  };

  const mockUncleanedKeyset = (all: Array<{ finishedAt: Date; id: string }>) => {
    modelMocks.listUncleanedFinished.mockImplementation(async ({ after, limit = 100 } = {}) => {
      const start = after
        ? all.findIndex(
            (row) =>
              row.finishedAt.getTime() > after.finishedAt.getTime() ||
              (row.finishedAt.getTime() === after.finishedAt.getTime() && row.id > after.id),
          )
        : 0;
      const from = start < 0 ? all.length : start;
      return all.slice(from, from + limit);
    });
  };

  it('rolls a failed leftover read back to a savepoint so later page rows still commit', async () => {
    const { all, laterId, leftover, poisonChild } = createPoisonSweepRows();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockUncleanedKeyset(all);
    modelMocks.findById.mockImplementation(async (id) => all.find((row) => row.id === id));
    messageMocks.findById.mockImplementation(async (id) => {
      if (id === poisonChild.id) throw new Error('poison cleanup');
      return id === leftover.id ? leftover : undefined;
    });
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === leftover.id) Object.assign(leftover, value);
    });

    await expect(
      sweepStaleConversationGenerationOperations(createAbortAwareHandle() as any),
    ).resolves.toBeUndefined();

    expect(modelMocks.listUncleanedFinished.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(leftover.content).toBe('');
    expect(modelMocks.markPlaceholdersCleaned).not.toHaveBeenCalledWith('operation-oldest');
    expect(modelMocks.markPlaceholdersCleaned).toHaveBeenCalledWith(laterId);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('rolls a failed leftover marker write back to a savepoint so later page rows still commit', async () => {
    const { all, laterId, leftover, poisonChild } = createPoisonSweepRows();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockUncleanedKeyset(all);
    modelMocks.findById.mockImplementation(async (id) => all.find((row) => row.id === id));
    modelMocks.markPlaceholdersCleaned.mockImplementation(async (id) => {
      if (id === 'operation-oldest') throw new Error('marker write failed');
      return { id };
    });
    messageMocks.findById.mockImplementation(async (id) => {
      if (id === poisonChild.id) return poisonChild;
      return id === leftover.id ? leftover : undefined;
    });
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === leftover.id) Object.assign(leftover, value);
      if (id === poisonChild.id) Object.assign(poisonChild, value);
    });

    await expect(
      sweepStaleConversationGenerationOperations(createAbortAwareHandle() as any),
    ).resolves.toBeUndefined();

    expect(modelMocks.listUncleanedFinished.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(leftover.content).toBe('');
    expect(modelMocks.markPlaceholdersCleaned).toHaveBeenCalledWith('operation-oldest');
    expect(modelMocks.markPlaceholdersCleaned).toHaveBeenCalledWith(laterId);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
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

  it('clears tracked child placeholders when a pending supervisor job is cancelled', async () => {
    const child = { content: LOADING_FLAT, id: 'child-pending-cancel' };
    const pending = {
      attempt: 1,
      config: {
        model: 'test-model',
        provider: 'test-provider',
        supervisorChildMessageIds: [child.id],
      },
      id: 'operation-pending-children',
      laneGeneration: 2,
      revision: 0,
      status: 'pending',
      userId: 'user-1',
    };
    modelMocks.findById.mockResolvedValue(pending);
    modelMocks.requestCancel.mockResolvedValue({ ...pending, status: 'cancelling' });
    modelMocks.finalizeActive.mockResolvedValue({
      ...pending,
      revision: 1,
      status: 'cancelled',
    });
    messageMocks.findById.mockImplementation(async (id) => (id === child.id ? child : undefined));
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === child.id) Object.assign(child, value);
    });

    await new ConversationGenerationService({} as any, 'user-1').cancel(pending.id);

    expect(child.content).toBe('');
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
