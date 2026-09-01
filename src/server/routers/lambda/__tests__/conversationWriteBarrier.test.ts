// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { createCompactionFingerprint } from '@/helpers/contextCompaction';

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
  mockServerDB: { transaction: vi.fn() },
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
    mockServerDB.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(mockTransaction),
    );
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

  it('merges the reported input watermark inside the conversation write lock', async () => {
    const mockFindById = vi.fn(async () => ({
      historySummary: 'new summary',
      metadata: {
        historySummaryLastMessageId: 'a2',
        memoryArchives: [{ at: 1, summaryExcerpt: 'new summary' }],
        reportedInputTokenFloorAfterMessageId: 'a3',
      },
      sessionId: 'session-1',
    }));
    const mockUpdate = vi.fn();
    const mockQueryMainTopicBoundaryRows = vi.fn(async () => [{ id: 'a3', role: 'assistant' }]);
    vi.mocked(TopicModel).mockImplementation(
      () =>
        ({
          batchCreate: mockBatchCreateTopics,
          findById: mockFindById,
          update: mockUpdate,
        }) as any,
    );
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          batchCreate: mockBatchCreateMessages,
          queryMainTopicBoundaryRows: mockQueryMainTopicBoundaryRows,
        }) as any,
    );

    const caller = topicRouter.createCaller(context as any);
    const result = await caller.mergeReportedInputTokenFloorWatermark({ id: 'topic-1' });

    expect(mockWithConversationWriteLockOrThrow).toHaveBeenCalledWith(
      mockServerDB,
      'user-1',
      expect.any(Function),
    );
    expect(TopicModel).toHaveBeenCalledWith(mockTransaction, 'user-1');
    expect(MessageModel).toHaveBeenCalledWith(mockTransaction, 'user-1');
    expect(result).toMatchObject({ updated: false });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('replaces compaction metadata inside the conversation write lock', async () => {
    const mockUpdate = vi.fn(async () => [{ id: 'topic-1' }]);
    vi.mocked(TopicModel).mockImplementation(
      () =>
        ({
          batchCreate: mockBatchCreateTopics,
          update: mockUpdate,
        }) as any,
    );

    const caller = topicRouter.createCaller(context as any);
    await caller.updateTopic({
      id: 'topic-1',
      value: {
        historySummary: 'new summary',
        metadata: { historySummaryLastMessageId: 'a2' },
      },
    });

    expect(mockWithConversationWriteLockOrThrow).toHaveBeenCalledWith(
      mockServerDB,
      'user-1',
      expect.any(Function),
    );
    expect(TopicModel).toHaveBeenCalledWith(mockTransaction, 'user-1');
    expect(mockUpdate).toHaveBeenCalledWith(
      'topic-1',
      {
        historySummary: 'new summary',
        metadata: { historySummaryLastMessageId: 'a2' },
      },
      { touchActivity: undefined },
    );
  });

  it('persists inline compaction inside the conversation write lock', async () => {
    const candidates = [
      { content: 'u1', id: 'u1', role: 'user', threadId: null },
      { content: 'a2', id: 'a2', role: 'assistant', threadId: null },
    ];
    const expectedFingerprint = createCompactionFingerprint({
      cursorId: 'a1',
      messages: candidates,
      summary: 'existing summary',
    });
    const mockFindById = vi.fn(async () => ({
      historySummary: 'existing summary',
      metadata: { historySummaryLastMessageId: 'a1' },
      sessionId: 'session-1',
    }));
    const mockUpdate = vi.fn();
    const mockLock = vi.fn(async () => candidates);
    const mockBoundary = vi.fn(async () => [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 'u2', role: 'user' },
      { id: 'a2', role: 'assistant' },
    ]);
    vi.mocked(TopicModel).mockImplementation(
      () =>
        ({
          batchCreate: mockBatchCreateTopics,
          findById: mockFindById,
          update: mockUpdate,
        }) as any,
    );
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          batchCreate: mockBatchCreateMessages,
          lockCompactionCandidateRows: mockLock,
          queryMainTopicBoundaryRows: mockBoundary,
        }) as any,
    );

    const caller = topicRouter.createCaller(context as any);
    const result = await caller.persistMemoryCompaction({
      candidateMessageIds: ['u1', 'a2'],
      compactedThroughMessageId: 'a2',
      expectedCursorId: 'a1',
      expectedFingerprint,
      expectedHistorySummary: 'existing summary',
      historySummary: 'new summary',
      id: 'topic-1',
      metadata: { historySummaryLastMessageId: 'a2' },
    });

    expect(mockWithConversationWriteLockOrThrow).toHaveBeenCalledWith(
      mockServerDB,
      'user-1',
      expect.any(Function),
    );
    expect(MessageModel).toHaveBeenCalledWith(mockTransaction, 'user-1');
    expect(mockLock).toHaveBeenCalledWith(['u1', 'a2']);
    expect(result).toMatchObject({ accepted: true });
    expect(mockUpdate).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ historySummary: 'new summary' }),
    );
  });

  it('clears compaction after a content edit that waited behind the candidate lock', async () => {
    let topic = {
      historySummary: 'new summary',
      metadata: { historySummaryLastMessageId: 'a2' },
      sessionId: 'session-1',
    };
    const mockLock = vi.fn(async () => [{ id: 'a2', topicId: 'topic-1' }]);
    const mockBoundary = vi.fn(async () => [
      { id: 'u1', role: 'user' },
      { id: 'a2', role: 'assistant' },
    ]);
    const mockUpdateMessage = vi.fn(async () => [{ id: 'a2' }]);
    const mockUpdateTopic = vi.fn(
      async (_id: string, data: { historySummary?: string; metadata?: object }) => {
        topic = { ...topic, ...data };
      },
    );
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          batchCreate: mockBatchCreateMessages,
          lockCompactionCandidateRows: mockLock,
          queryMainTopicBoundaryRows: mockBoundary,
          update: mockUpdateMessage,
        }) as any,
    );
    vi.mocked(TopicModel).mockImplementation(
      () =>
        ({
          batchCreate: mockBatchCreateTopics,
          findById: async () => structuredClone(topic),
          update: mockUpdateTopic,
        }) as any,
    );

    const caller = messageRouter.createCaller(context as any);
    await caller.update({ id: 'a2', value: { content: 'edited' } });

    expect(mockServerDB.transaction).toHaveBeenCalled();
    expect(mockLock).toHaveBeenCalledWith(['a2']);
    expect(mockUpdateTopic).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ historySummary: '' }),
    );
    expect(mockUpdateMessage).toHaveBeenCalledWith('a2', { content: 'edited' });
  });

  it('does not lock candidate rows for metadata-only message updates', async () => {
    const mockUpdateMessage = vi.fn(async () => [{ id: 'a2' }]);
    const mockLock = vi.fn();
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          batchCreate: mockBatchCreateMessages,
          lockCompactionCandidateRows: mockLock,
          update: mockUpdateMessage,
        }) as any,
    );

    const caller = messageRouter.createCaller(context as any);
    await caller.update({ id: 'a2', value: { metadata: { totalInputTokens: 1 } } });

    expect(mockLock).not.toHaveBeenCalled();
    expect(mockUpdateMessage).toHaveBeenCalledWith('a2', { metadata: { totalInputTokens: 1 } });
  });
});
