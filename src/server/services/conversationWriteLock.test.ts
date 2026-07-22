// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  withConversationClearLock,
  withConversationWriteLock,
} from './conversationWriteLock';

const createSelection = <Result>(getResult: () => Result[]) => ({
  from: () => ({
    where: () => ({
      for: () => ({
        limit: () => Promise.resolve(getResult()),
      }),
      limit: () => Promise.resolve(getResult()),
    }),
  }),
});

describe('conversation write lock', () => {
  it('rejects a writer whose epoch changed while waiting for the row lock', async () => {
    let conversationVersion = 'version-1';
    const writeCallback = vi.fn();
    const transaction = {
      select: () => createSelection(() => [{ version: conversationVersion }]),
    };
    const database = {
      select: () => createSelection(() => [{ version: conversationVersion }]),
      transaction: async (callback: (transaction: typeof transaction) => Promise<unknown>) => {
        conversationVersion = 'version-2';
        return callback(transaction);
      },
    };

    const result = await withConversationWriteLock(
      database as any,
      'user-1',
      writeCallback,
    );

    expect(result).toBeUndefined();
    expect(writeCallback).not.toHaveBeenCalled();
  });

  it('advances the epoch before running the clear callback', async () => {
    let conversationVersion = 'version-1';
    const clearCallback = vi.fn(async () => conversationVersion);
    const transaction = {
      select: () => createSelection(() => [{ id: 'user-1' }]),
      update: () => ({
        set: () => ({
          where: async () => {
            conversationVersion = 'version-2';
          },
        }),
      }),
    };
    const database = {
      transaction: async (callback: (transaction: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    };

    await expect(
      withConversationClearLock(database as any, 'user-1', clearCallback),
    ).resolves.toBe('version-2');
    expect(clearCallback).toHaveBeenCalledOnce();
  });
});
