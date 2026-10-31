import type { LobeChatDatabase } from '@lobechat/database';
import type { ChatTopicMetadata } from '@lobechat/types';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';

import { messages, topics } from '@/database/schemas';
import {
  formatTopicReferenceBlock,
  isTopicReferenceId,
  MAX_TOPIC_REFERENCES,
  parseTopicReferenceIds,
  type TopicReferenceMessage,
  type TopicReferenceSource,
  type TopicReferenceTurn,
} from '@/helpers/topicReference';

interface TopicMessageRow {
  content: string | null;
  id: string;
  role: string;
  topicId: string | null;
}

const toTurn = (row: TopicMessageRow): TopicReferenceTurn => ({
  content: row.content?.trim() ?? '',
  role: row.role,
});

const isTranscriptRow = (row: TopicMessageRow) =>
  (row.role === 'user' || row.role === 'assistant') && !!row.content?.trim();

const tailAfterCursor = (rows: TopicMessageRow[], cursorId?: string): TopicReferenceTurn[] => {
  if (!cursorId) return [];

  let seenCursor = false;
  const tail: TopicReferenceTurn[] = [];
  for (const row of rows) {
    if (!seenCursor) {
      if (row.id === cursorId) seenCursor = true;
      continue;
    }
    if (isTranscriptRow(row)) tail.push(toTurn(row));
  }
  return tail;
};

export const loadTopicReferenceBlock = async ({
  db,
  excludeTopicId,
  ids,
  messages: sourceMessages,
  userId,
}: {
  db: LobeChatDatabase;
  excludeTopicId?: string | null;
  ids?: string[];
  messages?: TopicReferenceMessage[];
  userId: string;
}): Promise<string> => {
  const requested = (ids ?? parseTopicReferenceIds(sourceMessages ?? [], { excludeTopicId }))
    .filter((id) => isTopicReferenceId(id) && id !== excludeTopicId)
    .slice(0, MAX_TOPIC_REFERENCES);
  if (requested.length === 0) return '';

  const topicRows = await db
    .select({
      historySummary: topics.historySummary,
      id: topics.id,
      metadata: topics.metadata,
      title: topics.title,
    })
    .from(topics)
    .where(and(eq(topics.userId, userId), inArray(topics.id, requested)));

  const cursorIds = topicRows
    .map((row) => (row.metadata as ChatTopicMetadata | null)?.historySummaryLastMessageId)
    .filter((id): id is string => !!id);
  const messageRows = await db
    .select({
      content: messages.content,
      id: messages.id,
      role: messages.role,
      topicId: messages.topicId,
    })
    .from(messages)
    .where(
      and(
        eq(messages.userId, userId),
        inArray(messages.topicId, requested),
        isNull(messages.threadId),
        cursorIds.length > 0
          ? or(inArray(messages.role, ['user', 'assistant']), inArray(messages.id, cursorIds))
          : inArray(messages.role, ['user', 'assistant']),
      ),
    )
    .orderBy(asc(messages.messageOrder));

  const rowsByTopic = new Map<string, TopicMessageRow[]>();
  for (const row of messageRows) {
    if (!row.topicId) continue;
    const list = rowsByTopic.get(row.topicId) ?? [];
    list.push(row);
    rowsByTopic.set(row.topicId, list);
  }

  const topicById = new Map(topicRows.map((row) => [row.id, row]));
  const sources: TopicReferenceSource[] = requested.map((id) => {
    const topic = topicById.get(id);
    if (!topic) return { found: false, id, tail: [], transcript: [] };

    const rows = rowsByTopic.get(id) ?? [];
    const cursor = (topic.metadata as ChatTopicMetadata | null)?.historySummaryLastMessageId;
    return {
      found: true,
      historySummary: topic.historySummary,
      id,
      tail: tailAfterCursor(rows, cursor),
      title: topic.title,
      transcript: rows.filter(isTranscriptRow).map(toTurn),
    };
  });

  return formatTopicReferenceBlock(sources);
};
