// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';

import { messageRouter } from '../message';
import { topicRouter } from '../topic';

const {
  mockBatchCreateMessages,
  mockBatchCreateTopics,
  mockGetServerDB,
  mockServerDB,
  mockTransaction,
  mockWithConversationWriteLockOrThrow,
} = vi.hoisted(() => ({
  mockBatchCreateMessages: vi.fn(),
  mockBatchCreateTopics: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockServerDB: {},
  mockTransaction: { transaction: 'conversation-write' },
  mockWithConversationWriteLockOrThrow: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/server/services/conversationWriteLock', () => ({
  withConversationWriteLockOrThrow: (...args: unknown[]) =>
    mockWithConversationWriteLockOrThrow(...args),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));

describe('conversation write barrier routers', () => {
  const context = {
    serverDB: mockServerDB,
    userId: 'user-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue(mockServerDB);
    mockBatchCreateMessages.mockResolvedValue({ rowCount: 2 });
    mockBatchCreateTopics.mockResolvedValue([{ id: 'topic-1' }, { id: 'topic-2' }]);
    mockWithConversationWriteLockOrThrow.mockImplementation(
      async (
        _database: unknown,
        _userId: string,
        callback: (transaction: unknown) => Promise<unknown>,
      ) => callback(mockTransaction),
    );
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          batchCreate: mockBatchCreateMessages,
        }) as any,
    );
    vi.mocked(TopicModel).mockImplementation(
      () =>
        ({
          batchCreate: mockBatchCreateTopics,
        }) as any,
    );
  });

  it('runs batch message imports inside the conversation write lock', async () => {
    const caller = messageRouter.createCaller(context as any);

    const result = await caller.batchCreateMessages({
      expectedConversationVersion: 7,
      messages: [{ id: 'message-1' }],
    });

    expect(result).toEqual({
      added: 2,
      ids: [],
      skips: [],
      success: true,
    });
    expect(mockWithConversationWriteLockOrThrow).toHaveBeenCalledWith(
      mockServerDB,
      'user-1',
      expect.any(Function),
      7,
    );
    expect(MessageModel).toHaveBeenCalledWith(mockTransaction, 'user-1');
    expect(mockBatchCreateMessages).toHaveBeenCalledWith([{ id: 'message-1' }]);
  });

  it('runs batch topic imports inside the conversation write lock', async () => {
    const caller = topicRouter.createCaller(context as any);

    const result = await caller.batchCreateTopics({
      expectedConversationVersion: 7,
      topics: [{ title: 'Imported topic' }],
    });

    expect(result).toEqual({
      added: 2,
      ids: [],
      skips: [],
      success: true,
    });
    expect(mockWithConversationWriteLockOrThrow).toHaveBeenCalledWith(
      mockServerDB,
      'user-1',
      expect.any(Function),
      7,
    );
    expect(TopicModel).toHaveBeenCalledWith(mockTransaction, 'user-1');
    expect(mockBatchCreateTopics).toHaveBeenCalledWith([{ title: 'Imported topic' }]);
  });
});
