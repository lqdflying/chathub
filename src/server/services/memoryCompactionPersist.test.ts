import { describe, expect, it } from 'vitest';

import type { ChatTopicMetadata } from '@lobechat/types';

import { createCompactionFingerprint } from '@/helpers/contextCompaction';

import { persistMemoryCompactionIfCurrent } from './memoryCompactionPersist';

const candidate = (id: string, role: 'user' | 'assistant', content = id) => ({
  content,
  id,
  role,
  threadId: null,
});

describe('persistMemoryCompactionIfCurrent', () => {
  it('rejects an equal-length candidate edit committed before persist', async () => {
    const original = [candidate('u1', 'user'), candidate('a2', 'assistant', 'a2')];
    const expectedFingerprint = createCompactionFingerprint({
      cursorId: 'a1',
      messages: original,
      summary: 'existing summary',
    });
    const rows = new Map(original.map((row) => [row.id, { ...row }]));
    rows.set('a2', { ...candidate('a2', 'assistant', 'b2') });
    let topic = {
      historySummary: 'existing summary',
      metadata: { historySummaryLastMessageId: 'a1' } as ChatTopicMetadata,
      sessionId: 'session-1',
    };
    const topicModel = {
      findById: async () => structuredClone(topic),
      update: async () => {
        throw new Error('stale summary must not be written');
      },
    };

    const result = await persistMemoryCompactionIfCurrent({
      candidateMessageIds: ['u1', 'a2'],
      compactedThroughMessageId: 'a2',
      expectedCursorId: 'a1',
      expectedFingerprint,
      expectedHistorySummary: 'existing summary',
      historySummary: 'stale candidate summary',
      messageModel: {
        lockCompactionCandidateRows: async (ids) =>
          ids.map((id) => rows.get(id)).filter(Boolean) as typeof original,
        queryMainTopicBoundaryRows: async () => [],
      },
      metadata: { historySummaryLastMessageId: 'a2' },
      topicId: 'topic-1',
      topicModel,
    });

    expect(result).toEqual({ accepted: false });
    expect('b2').toHaveLength('a2'.length);
  });

  it('rejects persist when a candidate row was deleted', async () => {
    const original = [candidate('u1', 'user'), candidate('a2', 'assistant')];
    const expectedFingerprint = createCompactionFingerprint({
      cursorId: 'a1',
      messages: original,
      summary: 'existing summary',
    });
    const rows = new Map([['u1', original[0]]]);
    let topic = {
      historySummary: 'existing summary',
      metadata: { historySummaryLastMessageId: 'a1' } as ChatTopicMetadata,
      sessionId: 'session-1',
    };

    const result = await persistMemoryCompactionIfCurrent({
      candidateMessageIds: ['u1', 'a2'],
      compactedThroughMessageId: 'a2',
      expectedCursorId: 'a1',
      expectedFingerprint,
      expectedHistorySummary: 'existing summary',
      historySummary: 'deleted candidate summary',
      messageModel: {
        lockCompactionCandidateRows: async (ids) =>
          ids.map((id) => rows.get(id)).filter(Boolean) as typeof original,
        queryMainTopicBoundaryRows: async () => [],
      },
      metadata: { historySummaryLastMessageId: 'a2' },
      topicId: 'topic-1',
      topicModel: {
        findById: async () => structuredClone(topic),
        update: async () => {
          throw new Error('deleted cursor must not be written');
        },
      },
    });

    expect(result).toEqual({ accepted: false });
  });

  it('rejects persist when a locked candidate belongs to a thread', async () => {
    const original = [candidate('u1', 'user'), candidate('a2', 'assistant')];
    const expectedFingerprint = createCompactionFingerprint({
      cursorId: 'a1',
      messages: original,
      summary: 'existing summary',
    });

    const result = await persistMemoryCompactionIfCurrent({
      candidateMessageIds: ['u1', 'a2'],
      compactedThroughMessageId: 'a2',
      expectedCursorId: 'a1',
      expectedFingerprint,
      expectedHistorySummary: 'existing summary',
      historySummary: 'thread candidate summary',
      messageModel: {
        lockCompactionCandidateRows: async () => [
          original[0],
          { ...original[1], threadId: 'thread-1' },
        ],
        queryMainTopicBoundaryRows: async () => {
          throw new Error('thread candidates must not query remaining rows');
        },
      },
      metadata: { historySummaryLastMessageId: 'a2' },
      topicId: 'topic-1',
      topicModel: {
        findById: async () => ({
          historySummary: 'existing summary',
          metadata: { historySummaryLastMessageId: 'a1' } as ChatTopicMetadata,
          sessionId: 'session-1',
        }),
        update: async () => {
          throw new Error('thread candidate must not be written');
        },
      },
    });

    expect(result).toEqual({ accepted: false });
  });

  it('writes a summary only after locked rows still match the expected fingerprint', async () => {
    const original = [candidate('u1', 'user'), candidate('a2', 'assistant')];
    const expectedFingerprint = createCompactionFingerprint({
      cursorId: 'a1',
      messages: original,
      summary: 'existing summary',
    });
    const rows = new Map(original.map((row) => [row.id, { ...row }]));
    let topic = {
      historySummary: 'existing summary',
      metadata: {
        historySummaryLastMessageId: 'a1',
        memoryArchives: [{ at: 1, summaryExcerpt: 'old', trigger: 'manual' as const }],
      } as ChatTopicMetadata,
      sessionId: 'session-1',
    };
    const topicModel = {
      findById: async () => structuredClone(topic),
      update: async (_id: string, data: { historySummary?: string; metadata?: ChatTopicMetadata }) => {
        topic = {
          ...topic,
          historySummary: data.historySummary ?? topic.historySummary,
          metadata: data.metadata ?? topic.metadata,
        };
      },
    };

    const result = await persistMemoryCompactionIfCurrent({
      candidateMessageIds: ['u1', 'a2'],
      compactedThroughMessageId: 'a2',
      expectedCursorId: 'a1',
      expectedFingerprint,
      expectedHistorySummary: 'existing summary',
      historySummary: 'new summary',
      messageModel: {
        lockCompactionCandidateRows: async (ids) =>
          ids.map((id) => rows.get(id)).filter(Boolean) as typeof original,
        queryMainTopicBoundaryRows: async () => [
          { id: 'u1', role: 'user' },
          { id: 'a1', role: 'assistant' },
          { id: 'u2', role: 'user' },
          { id: 'a2', role: 'assistant' },
          { id: 'u3', role: 'user' },
        ],
      },
      metadata: {
        historySummaryLastMessageId: 'a2',
        memoryArchives: [{ at: 2, summaryExcerpt: 'new summary', trigger: 'manual' }],
        memoryDebugLog: [{ at: 2, status: 'compacted', trigger: 'manual' }],
        model: 'summary-model',
        provider: 'summary-provider',
      },
      topicId: 'topic-1',
      topicModel,
    });

    expect(result).toMatchObject({ accepted: true });
    expect(topic.historySummary).toBe('new summary');
    expect(topic.metadata).toMatchObject({
      historySummaryLastMessageId: 'a2',
      memoryArchives: [{ at: 2, summaryExcerpt: 'new summary', trigger: 'manual' }],
      reportedInputTokenFloorAfterMessageId: 'u3',
    });
  });

  it('does not stamp a thread assistant as the remaining watermark', async () => {
    const original = [candidate('u1', 'user'), candidate('a2', 'assistant')];
    const expectedFingerprint = createCompactionFingerprint({
      cursorId: 'a1',
      messages: original,
      summary: 'existing summary',
    });
    let topic = {
      historySummary: 'existing summary',
      metadata: { historySummaryLastMessageId: 'a1' } as ChatTopicMetadata,
      sessionId: 'session-1',
    };

    const result = await persistMemoryCompactionIfCurrent({
      candidateMessageIds: ['u1', 'a2'],
      compactedThroughMessageId: 'a2',
      expectedCursorId: 'a1',
      expectedFingerprint,
      expectedHistorySummary: 'existing summary',
      historySummary: 'new summary',
      messageModel: {
        lockCompactionCandidateRows: async () => original,
        queryMainTopicBoundaryRows: async () => [
          { id: 'u1', role: 'user' },
          { id: 'a1', role: 'assistant' },
          { id: 'u2', role: 'user' },
          { id: 'a2', role: 'assistant' },
        ],
      },
      metadata: { historySummaryLastMessageId: 'a2' },
      topicId: 'topic-1',
      topicModel: {
        findById: async () => structuredClone(topic),
        update: async (_id: string, data: { metadata?: ChatTopicMetadata }) => {
          topic = { ...topic, metadata: data.metadata ?? topic.metadata };
        },
      },
    });

    expect(result).toMatchObject({ accepted: true });
    expect(
      result.accepted ? result.metadata.reportedInputTokenFloorAfterMessageId : undefined,
    ).toBe('a2');
  });
});
