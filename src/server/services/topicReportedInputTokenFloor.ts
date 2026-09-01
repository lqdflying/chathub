import type { ChatTopicMetadata, UIChatMessage } from '@lobechat/types';

import type { MessageModel } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';
import { nextReportedInputTokenFloorAfterMessageId } from '@/helpers/reportedContextTokens';

export interface ReportedInputTokenFloorMergeResult {
  metadata: ChatTopicMetadata;
  updated: boolean;
}

export const mergeReportedInputTokenFloorWatermark = async ({
  messageModel,
  topicId,
  topicModel,
}: {
  messageModel: Pick<MessageModel, 'query'>;
  topicId: string;
  topicModel: Pick<TopicModel, 'findById' | 'update'>;
}): Promise<ReportedInputTokenFloorMergeResult | undefined> => {
  const topic = await topicModel.findById(topicId);
  if (!topic) return undefined;

  const metadata: ChatTopicMetadata = { ...topic.metadata };
  const cursorId = metadata.historySummaryLastMessageId;
  const storedAfterMessageId = metadata.reportedInputTokenFloorAfterMessageId;
  if (!cursorId && !storedAfterMessageId) {
    return { metadata, updated: false };
  }

  const topicMessages = (await messageModel.query({
    pageSize: 9999,
    sessionId: topic.sessionId ?? undefined,
    topicId,
  })) as UIChatMessage[];
  const nextId = nextReportedInputTokenFloorAfterMessageId({
    cursorId,
    storedAfterMessageId,
    topicMessages,
  });
  if (nextId === storedAfterMessageId) {
    return { metadata, updated: false };
  }

  if (nextId) {
    metadata.reportedInputTokenFloorAfterMessageId = nextId;
  } else {
    delete metadata.reportedInputTokenFloorAfterMessageId;
  }

  await topicModel.update(topicId, { metadata });
  return { metadata, updated: true };
};
