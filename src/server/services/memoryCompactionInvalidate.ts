import type { ChatTopicMetadata } from '@lobechat/types';

import type { MessageModel } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';

export const compactionPrefixIncludesMessageIds = (
  boundaryRows: Array<{ id: string }>,
  cursorId: string | undefined,
  messageIds: string[],
) => {
  const cursorIndex = cursorId ? boundaryRows.findIndex((row) => row.id === cursorId) : -1;
  return messageIds.some((id) => {
    const index = boundaryRows.findIndex((row) => row.id === id);
    return index >= 0 && (cursorIndex < 0 || index <= cursorIndex);
  });
};

const clearedCompactionMetadata = (metadata: ChatTopicMetadata): ChatTopicMetadata => ({
  ...metadata,
  historySummaryLastMessageId: undefined,
  memoryArchives: [],
  reportedInputTokenFloorAfterMessageId: undefined,
});

/**
 * After candidate rows are locked, clear an authoritative summary when the
 * mutation targets the compacted prefix. Callers must `SELECT FOR UPDATE` the
 * mutated ids first so a compaction-first race is visible as the new cursor.
 * @see https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS
 */
export const invalidateCompactionIfMutatedPrefix = async ({
  messageIds,
  messageModel,
  topicModel,
}: {
  messageIds: string[];
  messageModel: Pick<MessageModel, 'lockCompactionCandidateRows' | 'queryMainTopicBoundaryRows'>;
  topicModel: Pick<TopicModel, 'findById' | 'update'>;
}): Promise<boolean> => {
  if (messageIds.length === 0) return false;

  const lockedRows = await messageModel.lockCompactionCandidateRows(messageIds);
  const topicIds = [
    ...new Set(lockedRows.flatMap((row) => (row.topicId ? [row.topicId] : []))),
  ];
  if (topicIds.length === 0) return false;

  let cleared = false;
  for (const topicId of topicIds) {
    const topic = await topicModel.findById(topicId);
    const metadata: ChatTopicMetadata = { ...topic?.metadata };
    const cursorId = metadata.historySummaryLastMessageId;
    if (
      !topic ||
      (!topic.historySummary &&
        !cursorId &&
        !metadata.reportedInputTokenFloorAfterMessageId)
    ) {
      continue;
    }

    const topicMessageIds = lockedRows
      .filter((row) => row.topicId === topicId)
      .map((row) => row.id);
    const boundaryRows = await messageModel.queryMainTopicBoundaryRows({
      sessionId: topic.sessionId ?? undefined,
      topicId,
    });
    if (!compactionPrefixIncludesMessageIds(boundaryRows, cursorId, topicMessageIds)) {
      continue;
    }

    await topicModel.update(topicId, {
      historySummary: '',
      metadata: clearedCompactionMetadata(metadata),
    });
    cleared = true;
  }

  return cleared;
};
