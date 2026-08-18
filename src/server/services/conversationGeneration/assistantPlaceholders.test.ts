/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@lobechat/const';

import {
  annotateAssistantError,
  clearOperationPlaceholders,
  clearUnfinishedPlaceholders,
  createAssistantMessageAndAssign,
  ensureOwnedAssistantPlaceholder,
  finalizeOperationWithCleanup,
  listOperationAssistantIds,
  resolveLatestAssistantMessageId,
  withConversationDbTransaction,
} from './assistantPlaceholders';

const messageMocks = vi.hoisted(() => ({
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
}));

const modelMocks = vi.hoisted(() => ({
  appendSupervisorChildMessageId: vi.fn(),
  finalizeActive: vi.fn(),
  findById: vi.fn(),
  insertEvent: vi.fn(),
  markPlaceholdersCleaned: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    create = messageMocks.create;
    findById = messageMocks.findById;
    update = messageMocks.update;
  },
}));

vi.mock('@/database/models/conversationGeneration', () => ({
  ConversationGenerationModel: class {
    appendSupervisorChildMessageId = modelMocks.appendSupervisorChildMessageId;
    finalizeActive = modelMocks.finalizeActive;
    findById = modelMocks.findById;
    insertEvent = modelMocks.insertEvent;
    markPlaceholdersCleaned = modelMocks.markPlaceholdersCleaned;
    update = modelMocks.update;
  },
}));

describe('assistant placeholder cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes the parent assistant and tracked supervisor children', () => {
    expect(
      listOperationAssistantIds({
        assistantMessageId: 'parent-1',
        config: { model: 'm', provider: 'p', supervisorChildMessageIds: ['child-1', 'child-2'] },
      } as any),
    ).toEqual(['parent-1', 'child-1', 'child-2']);
  });

  it('clears only LOADING_FLAT rows and never stamps an error onto finished content', async () => {
    const rows: Record<string, { content: string; error?: unknown }> = {
      'child-loading': { content: LOADING_FLAT },
      'child-done': { content: 'already answered' },
    };
    messageMocks.findById.mockImplementation(async (id: string) => rows[id]);
    messageMocks.update.mockImplementation(async (id: string, value: object) => {
      Object.assign(rows[id], value);
    });

    await clearUnfinishedPlaceholders({} as any, 'user-1', [
      'child-loading',
      'child-done',
      'missing',
    ]);

    expect(rows['child-loading'].content).toBe('');
    expect(rows['child-done']).toEqual({ content: 'already answered' });
    expect(messageMocks.update).toHaveBeenCalledTimes(1);
  });

  it('annotates only the failed assistant id', async () => {
    const rows: Record<string, { content: string; error?: unknown }> = {
      'child-failed': { content: 'partial answer' },
    };
    messageMocks.findById.mockImplementation(async (id: string) => rows[id]);
    messageMocks.update.mockImplementation(async (id: string, value: object) => {
      Object.assign(rows[id], value);
    });

    await annotateAssistantError({} as any, 'user-1', 'child-failed', {
      message: 'member failed',
      type: 'GroupAgentError',
    });

    expect(rows['child-failed']).toMatchObject({
      content: 'partial answer',
      error: { message: 'member failed', type: 'GroupAgentError' },
    });
  });

  it('falls back to the supplied operation when the latest row is missing', async () => {
    modelMocks.findById.mockResolvedValue(undefined);
    messageMocks.findById.mockResolvedValue({ content: LOADING_FLAT, id: 'child-1' });
    messageMocks.update.mockResolvedValue(undefined);

    await clearOperationPlaceholders(
      {} as any,
      {
        assistantMessageId: null,
        config: { model: 'm', provider: 'p', supervisorChildMessageIds: ['child-1'] },
        id: 'cgo-1',
        userId: 'user-1',
      } as any,
    );

    expect(messageMocks.update).toHaveBeenCalledWith('child-1', { content: '' });
  });
});

describe('conversation generation crash recovery helpers', () => {
  const operation = {
    agentId: 'agent-1',
    assistantMessageId: 'asst-1',
    attempt: 1,
    config: { model: 'm', provider: 'p' },
    id: 'cgo-1',
    laneGeneration: 1,
    parentMessageId: 'user-1',
    sessionId: 'session-1',
    userId: 'user-1',
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.findById.mockResolvedValue({ ...operation });
    modelMocks.update.mockResolvedValue({ ...operation, revision: 2 });
    modelMocks.appendSupervisorChildMessageId.mockImplementation(async (_id, childId) => ({
      ...operation,
      config: {
        ...operation.config,
        supervisorChildMessageIds: [
          ...new Set([...(operation.config.supervisorChildMessageIds || []), childId]),
        ],
      },
      revision: 2,
    }));
    modelMocks.markPlaceholdersCleaned.mockResolvedValue({
      ...operation,
      placeholdersCleanedAt: new Date(),
    });
    modelMocks.finalizeActive.mockResolvedValue({
      ...operation,
      revision: 3,
      status: 'failed',
    });
    modelMocks.insertEvent.mockResolvedValue({ id: 1 });
    messageMocks.create.mockImplementation(async (params, id) => ({
      content: params.content,
      id,
    }));
    messageMocks.findById.mockResolvedValue(undefined);
    messageMocks.update.mockResolvedValue(undefined);
  });

  it('runs the callback directly when the database handle has no transaction', async () => {
    const db = { label: 'passthrough' };
    const seen: unknown[] = [];

    await withConversationDbTransaction(db as any, async (trx) => {
      seen.push(trx);
      return 'ok';
    });

    expect(seen).toEqual([db]);
  });

  it('uses a database transaction when one is available', async () => {
    const inner = { label: 'trx' };
    const db = {
      transaction: vi.fn(async (callback: (trx: typeof inner) => Promise<string>) =>
        callback(inner),
      ),
    };

    const result = await withConversationDbTransaction(db as any, async (trx) => {
      expect(trx).toBe(inner);
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('recreates a missing owned assistant placeholder with the persisted id', async () => {
    messageMocks.findById.mockResolvedValueOnce(undefined);
    messageMocks.create.mockResolvedValue({ content: LOADING_FLAT, id: 'asst-1' });

    const created = await ensureOwnedAssistantPlaceholder({} as any, operation, 'asst-1');

    expect(messageMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: LOADING_FLAT, role: 'assistant' }),
      'asst-1',
    );
    expect(created).toMatchObject({ id: 'asst-1' });
  });

  it('creates the assistant row before assigning the operation pointer', async () => {
    const order: string[] = [];
    messageMocks.create.mockImplementation(async (_params, id) => {
      order.push(`create:${id}`);
      return { content: LOADING_FLAT, id };
    });
    modelMocks.update.mockImplementation(async (_id, value) => {
      if (value.assistantMessageId) order.push(`persist:${value.assistantMessageId}`);
      return { ...operation, ...value, revision: 2 };
    });

    await createAssistantMessageAndAssign({
      assignment: 'assistantMessageId',
      db: {} as any,
      id: 'asst-next',
      operation: { ...operation },
      params: { content: LOADING_FLAT, role: 'assistant', sessionId: 'session-1' } as any,
    });

    expect(order).toEqual(['create:asst-next', 'persist:asst-next']);
  });

  it('clears the new loading row when pointer assignment fails', async () => {
    const created = { content: LOADING_FLAT, id: 'asst-next' };
    messageMocks.create.mockResolvedValue(created);
    messageMocks.findById.mockImplementation(async (id) =>
      id === created.id ? created : undefined,
    );
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === created.id) Object.assign(created, value);
    });
    modelMocks.update.mockRejectedValue(new Error('pointer persist failed'));

    await expect(
      createAssistantMessageAndAssign({
        assignment: 'assistantMessageId',
        db: {} as any,
        id: created.id,
        operation: { ...operation },
        params: { content: LOADING_FLAT, role: 'assistant', sessionId: 'session-1' } as any,
      }),
    ).rejects.toThrow('pointer persist failed');

    expect(created.content).toBe('');
  });

  it('appends supervisor child ids through the atomic JSONB writer', async () => {
    const childCopy = {
      ...operation,
      config: {
        model: 'agent-model',
        provider: 'p',
        systemRole: 'group overlay',
      },
    };

    await createAssistantMessageAndAssign({
      assignment: 'supervisorChild',
      db: {} as any,
      id: 'child-2',
      operation: childCopy,
      params: { content: LOADING_FLAT, role: 'assistant', sessionId: 'session-1' } as any,
    });

    expect(modelMocks.appendSupervisorChildMessageId).toHaveBeenCalledWith('cgo-1', 'child-2', {
      attempt: 1,
      laneGeneration: 1,
    });
    expect(modelMocks.update).not.toHaveBeenCalled();
    expect(childCopy.config.supervisorChildMessageIds).toEqual(['child-2']);
  });

  it('keeps both concurrent supervisor child ids and clears both loading rows', async () => {
    const store = {
      ...operation,
      config: {
        model: 'supervisor-model',
        provider: 'p',
        supervisorChildMessageIds: [] as string[],
      },
    };
    const rows: Record<string, { content: string; id: string }> = {};
    let entered = 0;
    let releaseReaders: () => void = () => {};
    const bothEntered = new Promise<void>((resolve) => {
      releaseReaders = resolve;
    });
    let applyChain = Promise.resolve();
    modelMocks.appendSupervisorChildMessageId.mockImplementation(async (_id, childId) => {
      entered += 1;
      if (entered === 2) releaseReaders();
      await bothEntered;
      const run = applyChain.then(async () => {
        const next = [...new Set([...(store.config.supervisorChildMessageIds || []), childId])];
        store.config = { ...store.config, supervisorChildMessageIds: next };
        return { ...store, config: { ...store.config } };
      });
      applyChain = run.then(() => undefined);
      return run;
    });
    messageMocks.create.mockImplementation(async (params, id) => {
      rows[id] = { content: params.content, id };
      return rows[id];
    });
    messageMocks.findById.mockImplementation(async (id) => rows[id] ?? store);
    messageMocks.update.mockImplementation(async (id, value) => {
      if (rows[id]) Object.assign(rows[id], value);
    });
    modelMocks.findById.mockImplementation(async () => ({
      ...store,
      config: { ...store.config },
    }));

    await Promise.all([
      createAssistantMessageAndAssign({
        assignment: 'supervisorChild',
        db: {} as any,
        id: 'child-a',
        operation: { ...operation, config: { ...operation.config } },
        params: { content: LOADING_FLAT, role: 'assistant', sessionId: 'session-1' } as any,
      }),
      createAssistantMessageAndAssign({
        assignment: 'supervisorChild',
        db: {} as any,
        id: 'child-b',
        operation: { ...operation, config: { ...operation.config } },
        params: { content: LOADING_FLAT, role: 'assistant', sessionId: 'session-1' } as any,
      }),
    ]);

    expect(store.config.supervisorChildMessageIds).toEqual(
      expect.arrayContaining(['child-a', 'child-b']),
    );
    expect(store.config.supervisorChildMessageIds).toHaveLength(2);
    expect(rows['child-a']?.content).toBe(LOADING_FLAT);
    expect(rows['child-b']?.content).toBe(LOADING_FLAT);

    await clearOperationPlaceholders({} as any, store as any);

    expect(rows['child-a']?.content).toBe('');
    expect(rows['child-b']?.content).toBe('');
  });

  it('finalizes, emits, and clears loading rows inside one transaction', async () => {
    const inner = { label: 'trx' };
    const db = {
      transaction: vi.fn(async (callback: (trx: typeof inner) => Promise<unknown>) =>
        callback(inner),
      ),
    };
    const loading = { content: LOADING_FLAT, id: 'asst-1' };
    const current = {
      ...operation,
      config: { model: 'm', provider: 'p', supervisorChildMessageIds: ['child-1'] },
    };
    const child = { content: LOADING_FLAT, id: 'child-1' };
    modelMocks.finalizeActive.mockResolvedValue({
      ...current,
      revision: 4,
      status: 'cancelled',
    });
    messageMocks.findById.mockImplementation(async (id) => {
      if (id === loading.id) return loading;
      if (id === child.id) return child;
      return undefined;
    });
    messageMocks.update.mockImplementation(async (id, value) => {
      if (id === loading.id) Object.assign(loading, value);
      if (id === child.id) Object.assign(child, value);
    });

    await finalizeOperationWithCleanup({
      annotateMessageId: 'asst-1',
      db: db as any,
      error: { message: 'stopped', type: 'GenerationError' },
      operation: current as any,
      status: 'failed',
    });

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(modelMocks.finalizeActive).toHaveBeenCalledWith(
      'cgo-1',
      'failed',
      expect.objectContaining({ type: 'GenerationError' }),
      { attempt: 1, laneGeneration: 1 },
    );
    expect(modelMocks.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 4, type: 'error' }),
    );
    expect(loading.content).toBe('');
    expect(child.content).toBe('');
    expect(modelMocks.markPlaceholdersCleaned).toHaveBeenCalledWith('cgo-1');
  });

  it('resolves the latest persisted assistant id', async () => {
    modelMocks.findById.mockResolvedValue({ assistantMessageId: 'asst-latest' });

    await expect(resolveLatestAssistantMessageId({} as any, operation)).resolves.toBe(
      'asst-latest',
    );
  });
});
