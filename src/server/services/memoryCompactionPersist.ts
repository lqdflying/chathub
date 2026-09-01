import type { ChatTopicMetadata, UIChatMessage } from '@lobechat/types';

import type { MessageModel } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';
import { createCompactionFingerprint } from '@/helpers/contextCompaction';
import {
  remainingMessagesAfterCursor,
  withReportedInputTokenFloorMetadata,
} from '@/helpers/reportedContextTokens';

export type PersistMemoryCompactionResult =
  | { accepted: false }
  | { accepted: true; metadata: ChatTopicMetadata };

export const persistMemoryCompactionIfCurrent = async ({
  candidateMessageIds,
  compactedThroughMessageId,
  expectedCursorId,
  expectedFingerprint,
  expectedHistorySummary,
  historySummary,
  messageModel,
  metadata: incomingMetadata,
  topicId,
  topicModel,
}: {
  candidateMessageIds: string[];
  compactedThroughMessageId: string;
  expectedCursorId?: string;
  expectedFingerprint: string;
  expectedHistorySummary: string;
  historySummary: string;
  messageModel: Pick<MessageModel, 'lockCompactionCandidateRows' | 'queryMainTopicBoundaryRows'>;
  metadata: ChatTopicMetadata;
  topicId: string;
  topicModel: Pick<TopicModel, 'findById' | 'update'>;
}): Promise<PersistMemoryCompactionResult> => {
  const topic = await topicModel.findById(topicId);
  const metadata: ChatTopicMetadata = { ...topic?.metadata };
  if (
    !topic ||
    (topic.historySummary || '') !== (expectedHistorySummary || '') ||
    (metadata.historySummaryLastMessageId || undefined) !== (expectedCursorId || undefined)
  ) {
    return { accepted: false };
  }

  const lockedRows = await messageModel.lockCompactionCandidateRows(candidateMessageIds);
  if (lockedRows.some((row) => row.threadId)) {
    return { accepted: false };
  }

  const lockedById = new Map(lockedRows.map((row) => [row.id, row]));
  const latestCandidates = candidateMessageIds
    .map((id) => lockedById.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map(
      (row) =>
        ({
          content: row.content ?? '',
          id: row.id,
          role: row.role,
        }) as Pick<UIChatMessage, 'content' | 'id' | 'role'>,
    );
  const latestFingerprint = createCompactionFingerprint({
    cursorId: metadata.historySummaryLastMessageId,
    messages: latestCandidates,
    summary: topic.historySummary || undefined,
  });
  if (
    latestCandidates.length !== candidateMessageIds.length ||
    latestFingerprint !== expectedFingerprint
  ) {
    return { accepted: false };
  }

  const boundaryRows = await messageModel.queryMainTopicBoundaryRows({
    sessionId: topic.sessionId ?? undefined,
    topicId,
  });
  const persistMetadata = withReportedInputTokenFloorMetadata(
    {
      ...metadata,
      ...incomingMetadata,
      historySummaryLastMessageId: compactedThroughMessageId,
    },
    remainingMessagesAfterCursor(boundaryRows, compactedThroughMessageId),
  );

  await topicModel.update(topicId, {
    historySummary,
    metadata: persistMetadata,
  });
  return { accepted: true, metadata: persistMetadata };
};
