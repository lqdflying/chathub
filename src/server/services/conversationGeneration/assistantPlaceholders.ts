import { LOADING_FLAT } from '@lobechat/const';
import type { LobeChatDatabase, Transaction } from '@lobechat/database';
import type {
  ConversationGenerationError,
  ConversationGenerationOperation,
  ConversationGenerationStatus,
  CreateMessageParams,
} from '@lobechat/types';

import { ConversationGenerationModel } from '@/database/models/conversationGeneration';
import { MessageModel } from '@/database/models/message';

type ConversationDb = LobeChatDatabase | Transaction;

export const listOperationAssistantIds = (
  operation?: ConversationGenerationOperation | null,
) => [
  operation?.assistantMessageId,
  ...(operation?.config?.supervisorChildMessageIds || []),
];

export const withConversationDbTransaction = async <T>(
  db: ConversationDb,
  callback: (trx: ConversationDb) => Promise<T>,
): Promise<T> => {
  const transaction = (db as LobeChatDatabase).transaction;
  if (typeof transaction === 'function') {
    return transaction.call(db, async (trx: Transaction) => callback(trx));
  }
  return callback(db);
};

export const clearUnfinishedPlaceholders = async (
  db: ConversationDb,
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
  db: ConversationDb,
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
  db: ConversationDb,
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

export const resolveLatestAssistantMessageId = async (
  db: ConversationDb,
  operation: ConversationGenerationOperation,
) => {
  const latest = await new ConversationGenerationModel(db, operation.userId).findById(
    operation.id,
  );
  return latest?.assistantMessageId ?? operation.assistantMessageId ?? undefined;
};

export const ensureOwnedAssistantPlaceholder = async (
  db: ConversationDb,
  operation: ConversationGenerationOperation,
  assistantId: string,
) => {
  const messageModel = new MessageModel(db, operation.userId);
  const existing = await messageModel.findById(assistantId);
  if (existing) return existing;
  return messageModel.create(
    {
      agentId: operation.agentId ?? undefined,
      content: LOADING_FLAT,
      fromModel: operation.config.model,
      fromProvider: operation.config.provider,
      groupId: operation.groupId ?? undefined,
      parentId: operation.parentMessageId ?? operation.userMessageId ?? undefined,
      role: 'assistant',
      sessionId: operation.sessionId ?? operation.groupId ?? '',
      targetId: operation.config.targetId,
      threadId: operation.threadId ?? undefined,
      topicId: operation.topicId ?? undefined,
    },
    assistantId,
  );
};

export const createAssistantMessageAndAssign = async ({
  assignment,
  db,
  id,
  operation,
  params,
}: {
  assignment: 'assistantMessageId' | 'supervisorChild';
  db: ConversationDb;
  id: string;
  operation: ConversationGenerationOperation;
  params: CreateMessageParams;
}) => {
  const assignPointer = async (trx: ConversationDb) => {
    const model = new ConversationGenerationModel(trx, operation.userId);
    if (assignment === 'assistantMessageId') {
      const updated = await model.update(
        operation.id,
        { assistantMessageId: id },
        {
          attempt: operation.attempt,
          laneGeneration: operation.laneGeneration,
        },
      );
      if (!updated) {
        throw new Error('Conversation generation attempt no longer owns the operation.');
      }
      operation.assistantMessageId = id;
      return;
    }

    const updated = await model.appendSupervisorChildMessageId(operation.id, id, {
      attempt: operation.attempt,
      laneGeneration: operation.laneGeneration,
    });
    if (!updated) {
      throw new Error('Conversation generation attempt no longer owns the operation.');
    }
    operation.config = {
      ...operation.config,
      supervisorChildMessageIds: updated.config.supervisorChildMessageIds,
    };
  };

  return withConversationDbTransaction(db, async (trx) => {
    const created = await new MessageModel(trx, operation.userId).create(params, id);
    try {
      await assignPointer(trx);
      return created;
    } catch (error) {
      await clearUnfinishedPlaceholders(trx, operation.userId, [id]);
      throw error;
    }
  });
};

export const finalizeOperationWithCleanup = async ({
  annotateMessageId,
  db,
  error,
  extraMessageIds,
  operation,
  status,
}: {
  annotateMessageId?: string | null;
  db: ConversationDb;
  error?: ConversationGenerationError;
  extraMessageIds?: Array<string | null | undefined>;
  operation: ConversationGenerationOperation;
  status: Extract<ConversationGenerationStatus, 'succeeded' | 'cancelled' | 'failed' | 'interrupted'>;
}) => {
  return withConversationDbTransaction(db, async (trx) => {
    const model = new ConversationGenerationModel(trx, operation.userId);
    const updated = await model.finalizeActive(operation.id, status, error, {
      attempt: operation.attempt,
      laneGeneration: operation.laneGeneration,
    });
    if (!updated) return undefined;
    await model.insertEvent({
      operationId: operation.id,
      payload: {
        error,
        status,
      },
      revision: updated.revision,
      type: status === 'failed' ? 'error' : 'done',
    });
    await clearUnfinishedPlaceholders(trx, operation.userId, [
      ...listOperationAssistantIds(updated),
      ...listOperationAssistantIds(operation),
      ...(extraMessageIds || []),
    ]);
    if (error && annotateMessageId) {
      await annotateAssistantError(trx, operation.userId, annotateMessageId, error);
    }
    await model.markPlaceholdersCleaned(operation.id);
    return updated;
  });
};
