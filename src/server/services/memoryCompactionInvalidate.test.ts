import { describe, expect, it } from 'vitest';

import type { ChatTopicMetadata } from '@lobechat/types';

import {
  compactionPrefixIncludesMessageIds,
  invalidateCompactionIfMutatedPrefix,
} from './memoryCompactionInvalidate';

describe('compactionPrefixIncludesMessageIds', () => {
  const boundary = [{ id: 'u1' }, { id: 'a1' }, { id: 'u2' }, { id: 'a2' }, { id: 'u3' }];

  it('treats ids at or before the cursor as prefix mutations', () => {
    expect(compactionPrefixIncludesMessageIds(boundary, 'a2', ['a2'])).toBe(true);
    expect(compactionPrefixIncludesMessageIds(boundary, 'a2', ['u1'])).toBe(true);
    expect(compactionPrefixIncludesMessageIds(boundary, 'a2', ['u3'])).toBe(false);
  });
});

describe('invalidateCompactionIfMutatedPrefix', () => {
  const prefixRows = [
    { id: 'u1', role: 'user' },
    { id: 'a1', role: 'assistant' },
    { id: 'u2', role: 'user' },
    { id: 'a2', role: 'assistant' },
    { id: 'u3', role: 'user' },
  ];

  it('clears the summary when compaction committed first and the waiting edit is in the prefix', async () => {
    let topic = {
      historySummary: 'new summary',
      metadata: {
        historySummaryLastMessageId: 'a2',
        memoryArchives: [{ at: 2, summaryExcerpt: 'new summary', trigger: 'manual' as const }],
      } as ChatTopicMetadata,
      sessionId: 'session-1',
    };

    const cleared = await invalidateCompactionIfMutatedPrefix({
      messageIds: ['a2'],
      messageModel: {
        lockCompactionCandidateRows: async () => [
          { content: 'a2', id: 'a2', role: 'assistant', topicId: 'topic-1' },
        ],
        queryMainTopicBoundaryRows: async () => prefixRows,
      },
      topicModel: {
        findById: async () => structuredClone(topic),
        update: async (_id, data: { historySummary?: string; metadata?: ChatTopicMetadata }) => {
          topic = {
            ...topic,
            historySummary: data.historySummary ?? topic.historySummary,
            metadata: data.metadata ?? topic.metadata,
          };
        },
      },
    });

    expect(cleared).toBe(true);
    expect(topic.historySummary).toBe('');
    expect(topic.metadata.historySummaryLastMessageId).toBeUndefined();
    expect(topic.metadata.memoryArchives).toEqual([]);
  });

  it('clears the summary when a delete of the compacted-through cursor waits behind persist', async () => {
    let topic = {
      historySummary: 'new summary',
      metadata: { historySummaryLastMessageId: 'a2' } as ChatTopicMetadata,
      sessionId: 'session-1',
    };

    const cleared = await invalidateCompactionIfMutatedPrefix({
      messageIds: ['a2'],
      messageModel: {
        lockCompactionCandidateRows: async () => [
          { content: 'a2', id: 'a2', role: 'assistant', topicId: 'topic-1' },
        ],
        queryMainTopicBoundaryRows: async () => prefixRows,
      },
      topicModel: {
        findById: async () => structuredClone(topic),
        update: async (_id, data: { historySummary?: string; metadata?: ChatTopicMetadata }) => {
          topic = {
            ...topic,
            historySummary: data.historySummary ?? topic.historySummary,
            metadata: data.metadata ?? topic.metadata,
          };
        },
      },
    });

    expect(cleared).toBe(true);
    expect(topic.historySummary).toBe('');
  });

  it('leaves a post-cursor mutation in place', async () => {
    const topicModel = {
      findById: async () => ({
        historySummary: 'new summary',
        metadata: { historySummaryLastMessageId: 'a2' } as ChatTopicMetadata,
        sessionId: 'session-1',
      }),
      update: async () => {
        throw new Error('post-cursor mutation must not clear compaction');
      },
    };

    const cleared = await invalidateCompactionIfMutatedPrefix({
      messageIds: ['u3'],
      messageModel: {
        lockCompactionCandidateRows: async () => [
          { content: 'u3', id: 'u3', role: 'user', topicId: 'topic-1' },
        ],
        queryMainTopicBoundaryRows: async () => prefixRows,
      },
      topicModel,
    });

    expect(cleared).toBe(false);
  });
});
