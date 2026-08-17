import { describe, expect, it, vi } from 'vitest';

import { buildConversationCompactionMetadata } from './compaction';

describe('buildConversationCompactionMetadata', () => {
  it('persists the cursor, bounded archives, and a debug record from the durable plan', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_786_982_400_000);
    const metadata = buildConversationCompactionMetadata({
      compactedThroughMessageId: 'message-42',
      currentMetadata: {
        memoryArchives: Array.from({ length: 24 }, (_, index) => ({
          at: index,
          summaryExcerpt: `archive-${index}`,
        })),
        memoryDebugLog: Array.from({ length: 20 }, (_, index) => ({
          at: index,
          trigger: 'scheduled' as const,
        })),
      },
      messageCountIncluded: 12,
      model: 'summary-model',
      plan: {
        candidateMessageIds: ['message-1', 'message-42'],
        enableUserMemoryArchive: true,
        estimatedTokensBefore: 9000,
        expectedFingerprint: 'fingerprint',
        expectedHistorySummary: 'previous',
        highWatermark: 0.8,
        lowWatermark: 0.6,
        trigger: 'scheduled',
      },
      provider: 'summary-provider',
      status: 'compacted',
      summary: 'A new durable summary',
    });

    expect(metadata.historySummaryLastMessageId).toBe('message-42');
    expect(metadata.memoryArchives).toHaveLength(24);
    expect(metadata.memoryArchives?.at(-1)).toMatchObject({
      summaryExcerpt: 'A new durable summary',
      trigger: 'scheduled',
    });
    expect(metadata.memoryDebugLog).toHaveLength(20);
    expect(metadata.memoryDebugLog?.at(-1)).toMatchObject({
      compactedThroughMessageId: 'message-42',
      estimatedTokensBefore: 9000,
      messageCountIncluded: 12,
      model: 'summary-model',
      provider: 'summary-provider',
      status: 'compacted',
      trigger: 'scheduled',
    });
  });

  it('does not duplicate an existing archive excerpt', () => {
    const metadata = buildConversationCompactionMetadata({
      compactedThroughMessageId: 'message-2',
      currentMetadata: {
        memoryArchives: [{ at: 1, summaryExcerpt: 'Same summary' }],
      },
      messageCountIncluded: 2,
      model: 'model',
      plan: {
        candidateMessageIds: ['message-1', 'message-2'],
        enableUserMemoryArchive: true,
        expectedFingerprint: 'fingerprint',
        expectedHistorySummary: '',
        trigger: 'manual',
      },
      provider: 'provider',
      status: 'compacted',
      summary: 'Same summary',
    });

    expect(metadata.memoryArchives).toEqual([{ at: 1, summaryExcerpt: 'Same summary' }]);
  });
});
