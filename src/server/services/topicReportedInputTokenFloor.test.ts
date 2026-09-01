import { describe, expect, it } from 'vitest';

import type { ChatTopicMetadata, UIChatMessage } from '@lobechat/types';

import { mergeReportedInputTokenFloorWatermark } from './topicReportedInputTokenFloor';

const message = (id: string, role: UIChatMessage['role']): UIChatMessage =>
  ({ content: id, id, role }) as UIChatMessage;

describe('mergeReportedInputTokenFloorWatermark', () => {
  it('re-reads compacted metadata and only merges the watermark field', async () => {
    const topicMessages = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
      message('a2', 'assistant'),
      message('u3', 'user'),
      message('a3', 'assistant'),
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
      query: async () => topicMessages,
    };

    const compactMetadata: ChatTopicMetadata = {
      historySummaryLastMessageId: 'a2',
      memoryArchives: [{ at: 1, summaryExcerpt: 'new summary', trigger: 'manual' }],
      memoryDebugLog: [{ at: 1, status: 'compacted', trigger: 'manual' }],
      model: 'summary-model',
      provider: 'summary-provider',
      reportedInputTokenFloorAfterMessageId: 'a3',
    };

    // Durable/cross-tab compact commits first, then a delayed migration merge runs.
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

    expect(result).toEqual({ metadata: compactMetadata, updated: false });
    expect(topic.historySummary).toBe('new summary');
    expect(topic.metadata).toEqual(compactMetadata);
  });

  it('does not replace compaction fields when stamping a missing watermark', async () => {
    const topicMessages = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
      message('a2', 'assistant'),
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
      messageModel: { query: async () => topicMessages },
      topicId: 'topic-1',
      topicModel,
    });

    expect(result?.updated).toBe(true);
    expect(result?.metadata).toMatchObject({
      historySummaryLastMessageId: 'a1',
      memoryArchives: [{ at: 1, summaryExcerpt: 'new summary', trigger: 'manual' }],
      memoryDebugLog: [{ at: 1, status: 'compacted', trigger: 'manual' }],
      model: 'summary-model',
      provider: 'summary-provider',
      reportedInputTokenFloorAfterMessageId: 'a2',
    });
    expect(topic.historySummary).toBe('new summary');
  });
});
