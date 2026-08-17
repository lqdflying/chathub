import type {
  ChatTopicMetadata,
  ConversationGenerationCompactionSnapshot,
  MemoryCompactionStatus,
} from '@lobechat/types';

const MAX_MEMORY_DEBUG_LOG = 20;
const MAX_MEMORY_ARCHIVES = 24;

export const buildConversationCompactionMetadata = ({
  compactedThroughMessageId,
  currentMetadata,
  messageCountIncluded,
  model,
  plan,
  provider,
  status,
  summary,
}: {
  compactedThroughMessageId: string;
  currentMetadata: ChatTopicMetadata;
  messageCountIncluded: number;
  model: string;
  plan: ConversationGenerationCompactionSnapshot;
  provider: string;
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

  return {
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
  };
};
