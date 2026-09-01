import { describe, expect, it } from 'vitest';

import { ChatTopicMetadataSchema } from './topic';

describe('ChatTopicMetadataSchema', () => {
  it('preserves compaction cursor, archive, debug, and floor-watermark metadata', () => {
    const metadata = {
      historySummaryLastMessageId: 'message-42',
      memoryArchives: [
        { at: 1, summaryExcerpt: 'A durable summary', trigger: 'token_threshold' as const },
      ],
      memoryDebugLog: [
        {
          at: 2,
          compactedThroughMessageId: 'message-42',
          estimatedTokensAfter: 6000,
          estimatedTokensBefore: 8000,
          highWatermark: 0.8,
          lowWatermark: 0.6,
          messageCountIncluded: 4,
          reason: 'protected_context_exceeds_low_watermark',
          status: 'target_unreachable' as const,
          trigger: 'token_threshold' as const,
        },
      ],
      model: 'summary-model',
      provider: 'summary-provider',
      reportedInputTokenFloorAfterMessageId: 'assistant-99',
    };

    expect(ChatTopicMetadataSchema.parse(metadata)).toEqual(metadata);
  });
});
