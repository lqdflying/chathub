import type {
  ChatTopicMetadata,
  ConversationGenerationCompactionSnapshot,
  MemoryCompactionStatus,
  UIChatMessage,
} from '@lobechat/types';

import { withReportedInputTokenFloorMetadata } from '@/helpers/reportedContextTokens';

const MAX_MEMORY_DEBUG_LOG = 20;
const MAX_MEMORY_ARCHIVES = 24;

export const buildConversationCompactionMetadata = ({
  compactedThroughMessageId,
  currentMetadata,
  messageCountIncluded,
  model,
  plan,
  provider,
  remainingMessages,
  status,
  summary,
}: {
  compactedThroughMessageId: string;
  currentMetadata: ChatTopicMetadata;
  messageCountIncluded: number;
  model: string;
  plan: ConversationGenerationCompactionSnapshot;
  provider: string;
  remainingMessages: Array<
    Pick<UIChatMessage, 'children' | 'content' | 'id' | 'metadata' | 'role' | 'usage'>
  >;
  status: MemoryCompactionStatus;
  summary: string;
}): ChatTopicMetadata => {
  const previousArchives = currentMetadata.memoryArchives ?? [];
  const archiveExcerpt = summary.slice(0, 600);
  const shouldArchive =
    Boolean(plan.enableUserMemoryArchive && archiveExcerpt) &&
    !previousArchives.some(({ summaryExcerpt }) => summaryExcerpt === archiveExcerpt);
  const memoryArchives = shouldArchive
    ? [
        ...previousArchives.slice(-(MAX_MEMORY_ARCHIVES - 1)),
        { at: Date.now(), summaryExcerpt: archiveExcerpt, trigger: plan.trigger },
      ]
    : previousArchives;

  return withReportedInputTokenFloorMetadata(
    {
      ...currentMetadata,
      historySummaryLastMessageId: compactedThroughMessageId,
      memoryArchives,
      memoryDebugLog: [
        ...(currentMetadata.memoryDebugLog ?? []).slice(-(MAX_MEMORY_DEBUG_LOG - 1)),
        {
          at: Date.now(),
          compactedThroughMessageId,
          estimatedTokensBefore: plan.estimatedTokensBefore,
          highWatermark: plan.highWatermark,
          lowWatermark: plan.lowWatermark,
          messageCountIncluded,
          model,
          provider,
          status,
          trigger: plan.trigger,
        },
      ],
      model,
      provider,
    },
    remainingMessages,
  );
};
