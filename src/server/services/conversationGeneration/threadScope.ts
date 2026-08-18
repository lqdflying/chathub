import type { LobeChatDatabase } from '@lobechat/database';
import type { UIChatMessage } from '@lobechat/types';

import { ThreadModel } from '@/database/models/thread';

export const filterMessagesForConversationThread = (
  messages: UIChatMessage[],
  thread?: { id: string; sourceMessageId: string } | null,
) => {
  if (!thread) return messages.filter((message) => !message.threadId);

  const sourceIndex = messages.findIndex((message) => message.id === thread.sourceMessageId);
  const prefix = sourceIndex >= 0 ? messages.slice(0, sourceIndex + 1) : [];
  return [...prefix, ...messages.filter((message) => message.threadId === thread.id)];
};

export const loadConversationThreadMessages = async (
  db: LobeChatDatabase,
  userId: string,
  messages: UIChatMessage[],
  threadId?: string | null,
) => {
  if (!threadId) return filterMessagesForConversationThread(messages);

  const thread = await new ThreadModel(db, userId).findById(threadId);
  if (!thread?.sourceMessageId) return filterMessagesForConversationThread(messages);

  return filterMessagesForConversationThread(messages, {
    id: thread.id,
    sourceMessageId: thread.sourceMessageId,
  });
};
