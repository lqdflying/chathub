import type { ChatTopicMetadata } from '@lobechat/types';

import type { MessageModel } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';
import { nextReportedInputTokenFloorAfterMessageId } from '@/helpers/reportedContextTokens';

export interface ReportedInputTokenFloorMergeResult {
  historySummary?: string | null;
  historySummaryLastMessageId?: string;
  reportedInputTokenFloorAfterMessageId?: string;
  updated: boolean;
}

export const mergeReportedInputTokenFloorWatermark = async ({
  messageModel,
  topicId,
  topicModel,
}: {
  messageModel: Pick<MessageModel, 'queryMainTopicBoundaryRows'>;
  topicId: string;
  topicModel: Pick<TopicModel, 'findById' | 'update'>;
}): Promise<ReportedInputTokenFloorMergeResult | undefined> => {
  const topic = await topicModel.findById(topicId);
  if (!topic) return undefined;

  const metadata: ChatTopicMetadata = { ...topic.metadata };
  const cursorId = metadata.historySummaryLastMessageId;
  const storedAfterMessageId = metadata.reportedInputTokenFloorAfterMessageId;
  if (!cursorId && !storedAfterMessageId) {
    return {
      historySummary: topic.historySummary,
      historySummaryLastMessageId: cursorId,
      reportedInputTokenFloorAfterMessageId: storedAfterMessageId,
      updated: false,
    };
  }

  const topicMessages = await messageModel.queryMainTopicBoundaryRows({
    sessionId: topic.sessionId ?? undefined,
    topicId,
  });
  const nextId = nextReportedInputTokenFloorAfterMessageId({
    cursorId,
    storedAfterMessageId,
    topicMessages,
  });
  if (nextId === storedAfterMessageId) {
    return {
      historySummary: topic.historySummary,
      historySummaryLastMessageId: cursorId,
      reportedInputTokenFloorAfterMessageId: storedAfterMessageId,
      updated: false,
    };
  }

  if (nextId) {
    metadata.reportedInputTokenFloorAfterMessageId = nextId;
  } else {
    delete metadata.reportedInputTokenFloorAfterMessageId;
  }

  await topicModel.update(topicId, { metadata });
  return {
    historySummary: topic.historySummary,
    historySummaryLastMessageId: cursorId,
    reportedInputTokenFloorAfterMessageId: nextId,
    updated: true,
  };
};
