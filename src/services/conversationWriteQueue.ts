import type { Transaction } from '@lobechat/database';
import { eq, sql } from 'drizzle-orm';

import { clientDB } from '@/database/client/db';
import { users } from '@/database/schemas';

const conversationWriteQueues = new Map<string, Promise<void>>();

export class ClientConversationWriteRejectedError extends Error {
  constructor() {
    super('Conversation write was rejected because conversation history was cleared.');
    this.name = 'ClientConversationWriteRejectedError';
  }
}

type ClientConversationWriteCallback<Result> = (
  transaction: Transaction,
) => Promise<Result>;

const enqueueClientConversationWrite = async <Result>(
  userId: string,
  operation: () => Promise<Result>,
): Promise<Result> => {
  const previousWrite = conversationWriteQueues.get(userId) ?? Promise.resolve();
  let releaseCurrentWrite!: () => void;
  const currentWrite = new Promise<void>((resolve) => {
    releaseCurrentWrite = resolve;
  });

  conversationWriteQueues.set(userId, currentWrite);
  await previousWrite.catch(() => undefined);

  try {
    return await operation();
  } finally {
    releaseCurrentWrite();

    if (conversationWriteQueues.get(userId) === currentWrite) {
      conversationWriteQueues.delete(userId);
    }
  }
};

export const getClientConversationVersion = async (userId: string): Promise<number> => {
  const [user] = await clientDB
    .select({ version: users.conversationVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new ClientConversationWriteRejectedError();
  }

  return user.version;
};

export const withClientConversationWriteQueue = async <Result>(
  userId: string,
  operation: ClientConversationWriteCallback<Result>,
  expectedConversationVersion?: number,
): Promise<Result> => {
  const observedConversationVersion =
    expectedConversationVersion ?? (await getClientConversationVersion(userId));

  return enqueueClientConversationWrite(userId, () =>
    clientDB.transaction(async (transaction) => {
      const [user] = await transaction
        .select({ version: users.conversationVersion })
        .from(users)
        .where(eq(users.id, userId))
        .for('update')
        .limit(1);

      if (!user || user.version !== observedConversationVersion) {
        throw new ClientConversationWriteRejectedError();
      }

      return operation(transaction as Transaction);
    }),
  );
};

export const withClientConversationClearLock = async <Result>(
  userId: string,
  operation: ClientConversationWriteCallback<Result>,
): Promise<Result> => {
  return enqueueClientConversationWrite(userId, () =>
    clientDB.transaction(async (transaction) => {
      const [user] = await transaction
        .update(users)
        .set({ conversationVersion: sql`${users.conversationVersion} + 1` })
        .where(eq(users.id, userId))
        .returning({ version: users.conversationVersion });

      if (!user) {
        throw new ClientConversationWriteRejectedError();
      }

      return operation(transaction as Transaction);
    }),
  );
};
