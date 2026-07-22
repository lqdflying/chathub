import type { LobeChatDatabase, Transaction } from '@lobechat/database';
import { eq, sql } from 'drizzle-orm';

import { users } from '@/database/schemas';

export class ConversationWriteRejectedError extends Error {
  constructor() {
    super('Conversation write was rejected because conversation history was cleared.');
    this.name = 'ConversationWriteRejectedError';
  }
}

type ConversationWriteCallback<Result> = (
  transaction: Transaction,
) => Promise<Result>;

export const getConversationVersion = async (
  database: LobeChatDatabase,
  userId: string,
): Promise<number | undefined> => {
  const [user] = await database
    .select({ version: users.conversationVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user?.version;
};

/**
 * Serializes conversation writes with history clearing.
 *
 * The initial read is intentionally unlocked. If clearing obtains the row lock
 * before this writer does, the second read observes the new conversation version and
 * rejects the stale write after the clear commits.
 */
export const withConversationWriteLock = async <Result>(
  database: LobeChatDatabase,
  userId: string,
  callback: ConversationWriteCallback<Result>,
  expectedConversationVersion?: number,
): Promise<Result | undefined> => {
  const observedConversationVersion =
    expectedConversationVersion ?? (await getConversationVersion(database, userId));

  if (observedConversationVersion === undefined) return undefined;

  return database.transaction(async (transaction) => {
    const [lockedUser] = await transaction
      .select({ version: users.conversationVersion })
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);

    if (!lockedUser || lockedUser.version !== observedConversationVersion) return undefined;

    return callback(transaction);
  });
};

export const withConversationWriteLockOrThrow = async <Result>(
  database: LobeChatDatabase,
  userId: string,
  callback: ConversationWriteCallback<Result>,
  expectedConversationVersion?: number,
): Promise<Result> => {
  const result = await withConversationWriteLock(
    database,
    userId,
    callback,
    expectedConversationVersion,
  );

  if (result === undefined) {
    throw new ConversationWriteRejectedError();
  }

  return result;
};

export const advanceConversationVersion = async (
  transaction: Transaction,
  userId: string,
): Promise<void> => {
  await transaction
    .update(users)
    .set({ conversationVersion: sql`${users.conversationVersion} + 1` })
    .where(eq(users.id, userId));
};

export const withConversationClearLock = async <Result>(
  database: LobeChatDatabase,
  userId: string,
  callback: ConversationWriteCallback<Result>,
): Promise<Result | undefined> => {
  return database.transaction(async (transaction) => {
    const [lockedUser] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);

    if (!lockedUser) return undefined;

    await advanceConversationVersion(transaction, userId);
    return callback(transaction);
  });
};
