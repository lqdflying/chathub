import { LOADING_FLAT } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type {
  ConversationGenerationError,
  ConversationGenerationOperation,
} from '@lobechat/types';

import { ConversationGenerationModel } from '@/database/models/conversationGeneration';
import { MessageModel } from '@/database/models/message';

export const listOperationAssistantIds = (
  operation?: ConversationGenerationOperation | null,
) => [
  operation?.assistantMessageId,
  ...(operation?.config?.supervisorChildMessageIds || []),
];

export const clearUnfinishedPlaceholders = async (
  db: LobeChatDatabase,
  userId: string,
  messageIds: Array<string | null | undefined>,
) => {
  const ids = [
    ...new Set(
      messageIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  if (ids.length === 0) return;
  const messageModel = new MessageModel(db, userId);
  for (const messageId of ids) {
    const current = await messageModel.findById(messageId);
    if (!current || current.content !== LOADING_FLAT) continue;
    await messageModel.update(messageId, { content: '' });
  }
};

export const annotateAssistantError = async (
  db: LobeChatDatabase,
  userId: string,
  messageId: string | null | undefined,
  error: ConversationGenerationError,
) => {
  if (!messageId) return;
  const messageModel = new MessageModel(db, userId);
  const current = await messageModel.findById(messageId);
  if (!current) return;
  await messageModel.update(messageId, {
    ...(current.content === LOADING_FLAT ? { content: '' } : {}),
    error: error as any,
  });
};

export const clearOperationPlaceholders = async (
  db: LobeChatDatabase,
  operation: ConversationGenerationOperation,
  extraMessageIds: Array<string | null | undefined> = [],
) => {
  const latest = await new ConversationGenerationModel(db, operation.userId).findById(
    operation.id,
  );
  await clearUnfinishedPlaceholders(db, operation.userId, [
    ...listOperationAssistantIds(latest ?? operation),
    ...extraMessageIds,
  ]);
};
