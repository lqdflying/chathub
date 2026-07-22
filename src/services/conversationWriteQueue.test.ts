import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClientConversationWriteRejectedError,
  withClientConversationClearLock,
  withClientConversationWriteQueue,
} from './conversationWriteQueue';

const { databaseState, mockClientDB } = vi.hoisted(() => {
  const databaseState = { conversationVersion: 0 };

  const createSelection = () => ({
    from: () => ({
      where: () => ({
        for: () => ({
          limit: async () => [{ version: databaseState.conversationVersion }],
        }),
        limit: async () => [{ version: databaseState.conversationVersion }],
      }),
    }),
  });

  const mockTransaction = {
    select: vi.fn(createSelection),
    update: vi.fn(() => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            databaseState.conversationVersion += 1;
            return [{ version: databaseState.conversationVersion }];
          },
        }),
      }),
    })),
  };

  const mockClientDB = {
    select: vi.fn(createSelection),
    transaction: vi.fn(
      async (callback: (transaction: typeof mockTransaction) => Promise<unknown>) =>
        callback(mockTransaction),
    ),
  };

  return { databaseState, mockClientDB };
});

vi.mock('@/database/client/db', () => ({
  clientDB: mockClientDB,
}));

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

describe('withClientConversationWriteQueue', () => {
  beforeEach(() => {
    databaseState.conversationVersion = 0;
    vi.clearAllMocks();
  });

  it('rejects a pre-clear write that was queued before the conversation version advanced', async () => {
    const activeWriteGate = createDeferred();
    const activeWriteStarted = createDeferred();
    const operations: string[] = [];

    const activeWrite = withClientConversationWriteQueue(
      'user-1',
      async () => {
        operations.push('write:start');
        activeWriteStarted.resolve();
        await activeWriteGate.promise;
        operations.push('write:end');
      },
      0,
    );

    await activeWriteStarted.promise;

    const clearHistory = withClientConversationClearLock('user-1', async () => {
      operations.push('clear');
    });
    const staleQueuedWrite = withClientConversationWriteQueue('user-1', async () => {
      operations.push('stale-write');
    });

    expect(operations).toEqual(['write:start']);
    activeWriteGate.resolve();
    await activeWrite;
    await clearHistory;

    await expect(staleQueuedWrite).rejects.toBeInstanceOf(ClientConversationWriteRejectedError);
    expect(databaseState.conversationVersion).toBe(1);
    expect(operations).toEqual(['write:start', 'write:end', 'clear']);
  });

  it('accepts a write that captures the advanced version after clearing completes', async () => {
    await withClientConversationClearLock('user-1', async () => undefined);

    await expect(
      withClientConversationWriteQueue('user-1', async () => 'created'),
    ).resolves.toBe('created');
    expect(databaseState.conversationVersion).toBe(1);
  });

  it('continues the queue after a rejected write', async () => {
    const failedWrite = withClientConversationWriteQueue('user-2', async () => {
      throw new Error('write failed');
    });
    const clearHistory = withClientConversationWriteQueue('user-2', async () => 'cleared');

    await expect(failedWrite).rejects.toThrow('write failed');
    await expect(clearHistory).resolves.toBe('cleared');
  });

  it('runs writes for different users independently', async () => {
    const firstUserGate = createDeferred();
    const operations: string[] = [];

    const firstUserWrite = withClientConversationWriteQueue('user-3', async () => {
      operations.push('first-user:start');
      await firstUserGate.promise;
      operations.push('first-user:end');
    });
    const secondUserWrite = withClientConversationWriteQueue('user-4', async () => {
      operations.push('second-user');
    });

    await secondUserWrite;
    expect(operations).toEqual(['first-user:start', 'second-user']);

    firstUserGate.resolve();
    await firstUserWrite;
    expect(operations).toEqual(['first-user:start', 'second-user', 'first-user:end']);
  });
});
