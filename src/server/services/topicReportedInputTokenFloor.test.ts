import { describe, expect, it } from 'vitest';

import type { ChatTopicMetadata } from '@lobechat/types';

import { getLatestReportedInputTokens } from '@/helpers/reportedContextTokens';

import { mergeReportedInputTokenFloorWatermark } from './topicReportedInputTokenFloor';

const row = (id: string, role: 'user' | 'assistant') => ({ id, role });

describe('mergeReportedInputTokenFloorWatermark', () => {
  it('re-reads compacted metadata and only merges the watermark field', async () => {
    const topicMessages = [
      row('u1', 'user'),
      row('a1', 'assistant'),
      row('u2', 'user'),
      row('a2', 'assistant'),
      row('u3', 'user'),
      row('a3', 'assistant'),
    ];
    let topic = {
      historySummary: 'old summary',
      metadata: { historySummaryLastMessageId: 'a1' } as ChatTopicMetadata,
      sessionId: 'session-1',
    };
    const topicModel = {
      findById: async () => structuredClone(topic),
      update: async (_id: string, data: { metadata?: ChatTopicMetadata }) => {
        topic = {
          ...topic,
          metadata: data.metadata ?? topic.metadata,
        };
      },
    };
    const messageModel = {
      query: async () => {
        throw new Error('hydration query must not be used for watermark merge');
      },
      queryMainTopicBoundaryRows: async () => topicMessages,
    };

    const compactMetadata: ChatTopicMetadata = {
      historySummaryLastMessageId: 'a2',
      memoryArchives: [{ at: 1, summaryExcerpt: 'new summary', trigger: 'manual' }],
      memoryDebugLog: [{ at: 1, status: 'compacted', trigger: 'manual' }],
      model: 'summary-model',
      provider: 'summary-provider',
      reportedInputTokenFloorAfterMessageId: 'a3',
    };

    topic = {
      historySummary: 'new summary',
      metadata: compactMetadata,
      sessionId: 'session-1',
    };

    const result = await mergeReportedInputTokenFloorWatermark({
      messageModel,
      topicId: 'topic-1',
      topicModel,
    });

    expect(result).toEqual({
      historySummary: 'new summary',
      historySummaryLastMessageId: 'a2',
      reportedInputTokenFloorAfterMessageId: 'a3',
      updated: false,
    });
    expect(topic.historySummary).toBe('new summary');
    expect(topic.metadata).toEqual(compactMetadata);
  });

  it('does not replace compaction fields when stamping a missing watermark', async () => {
    const topicMessages = [
      row('u1', 'user'),
      row('a1', 'assistant'),
      row('u2', 'user'),
      row('a2', 'assistant'),
    ];
    let topic = {
      historySummary: 'new summary',
      metadata: {
        historySummaryLastMessageId: 'a1',
        memoryArchives: [{ at: 1, summaryExcerpt: 'new summary', trigger: 'manual' }],
        memoryDebugLog: [{ at: 1, status: 'compacted', trigger: 'manual' }],
        model: 'summary-model',
        provider: 'summary-provider',
      } as ChatTopicMetadata,
      sessionId: 'session-1',
    };
    const topicModel = {
      findById: async () => structuredClone(topic),
      update: async (_id: string, data: { metadata?: ChatTopicMetadata }) => {
        topic = {
          ...topic,
          metadata: data.metadata ?? topic.metadata,
        };
      },
    };

    const result = await mergeReportedInputTokenFloorWatermark({
      messageModel: { queryMainTopicBoundaryRows: async () => topicMessages },
      topicId: 'topic-1',
      topicModel,
    });

    expect(result).toEqual({
      historySummary: 'new summary',
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a2',
      updated: true,
    });
    expect(topic.metadata).toMatchObject({
      historySummaryLastMessageId: 'a1',
      memoryArchives: [{ at: 1, summaryExcerpt: 'new summary', trigger: 'manual' }],
      memoryDebugLog: [{ at: 1, status: 'compacted', trigger: 'manual' }],
      model: 'summary-model',
      provider: 'summary-provider',
      reportedInputTokenFloorAfterMessageId: 'a2',
    });
    expect(topic.historySummary).toBe('new summary');
  });

  it('ignores a newer thread assistant when choosing the main-topic watermark', async () => {
    const mainTopicMessages = [
      row('u1', 'user'),
      row('a1', 'assistant'),
      row('u2', 'user'),
      row('a2', 'assistant'),
    ];
    let topic = {
      historySummary: 'summary',
      metadata: {
        historySummaryLastMessageId: 'a1',
      } as ChatTopicMetadata,
      sessionId: 'session-1',
    };
    const topicModel = {
      findById: async () => structuredClone(topic),
      update: async (_id: string, data: { metadata?: ChatTopicMetadata }) => {
        topic = { ...topic, metadata: data.metadata ?? topic.metadata };
      },
    };

    const result = await mergeReportedInputTokenFloorWatermark({
      messageModel: {
        queryMainTopicBoundaryRows: async () => mainTopicMessages,
      },
      topicId: 'topic-1',
      topicModel,
    });

    expect(result?.reportedInputTokenFloorAfterMessageId).toBe('a2');
    expect(topic.metadata.reportedInputTokenFloorAfterMessageId).toBe('a2');

    const estimatorMessages = [
      { content: 'u1', id: 'u1', role: 'user' as const },
      { content: 'a1', id: 'a1', metadata: { totalInputTokens: 400_000 }, role: 'assistant' as const },
      { content: 'u2', id: 'u2', role: 'user' as const },
      { content: 'a2', id: 'a2', metadata: { totalInputTokens: 500_000 }, role: 'assistant' as const },
      { content: 'u3', id: 'u3', role: 'user' as const },
      { content: 'a3', id: 'a3', metadata: { totalInputTokens: 700_000 }, role: 'assistant' as const },
    ];
    expect(
      getLatestReportedInputTokens(estimatorMessages, {
        afterMessageId: result?.reportedInputTokenFloorAfterMessageId,
        lookupMessages: estimatorMessages,
      }),
    ).toBe(700_000);
  });

  it('does not rotate a tail marker when more than 9999 main-topic rows exist', async () => {
    const topicMessages = Array.from({ length: 10_001 }, (_, index) =>
      row(`m${index + 1}`, index % 2 === 0 ? 'user' : 'assistant'),
    );
    expect(topicMessages.at(-1)?.id).toBe('m10001');

    let topic = {
      historySummary: 'summary',
      metadata: {
        historySummaryLastMessageId: 'm1',
        reportedInputTokenFloorAfterMessageId: 'm10001',
      } as ChatTopicMetadata,
      sessionId: 'session-1',
    };
    const topicModel = {
      findById: async () => structuredClone(topic),
      update: async () => {
        throw new Error('tail marker must not be rewritten');
      },
    };

    const result = await mergeReportedInputTokenFloorWatermark({
      messageModel: { queryMainTopicBoundaryRows: async () => topicMessages },
      topicId: 'topic-1',
      topicModel,
    });

    expect(result).toMatchObject({
      reportedInputTokenFloorAfterMessageId: 'm10001',
      updated: false,
    });
  });
});
