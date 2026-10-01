import type { LobeChatDatabase } from '@lobechat/database';
import type { UIChatMessage } from '@lobechat/types';

import { ThreadModel } from '@/database/models/thread';
import { filterMessagesForConversationThread } from '@/helpers/conversationThreadMessages';

export { filterMessagesForConversationThread };

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
    type: thread.type,
  });
};
