import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ImporterEntryData } from '@/types/importer';

import { getTestDB } from '../../../models/__tests__/_util';
import { messages, users } from '../../../schemas';
import { DeprecatedDataImporterRepos } from '../deprecated';

const db = await getTestDB();
const userId = 'deprecated-import-message-order-user';

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  await db.delete(users);
});

describe('DeprecatedDataImporterRepos message order', () => {
  it('allocates fresh sequence values instead of importing messageOrder', async () => {
    const importer = new DeprecatedDataImporterRepos(db, userId);
    const data: ImporterEntryData = {
      version: 7,
      messages: [
        {
          content: 'Child message',
          createdAt: 1715186011586,
          id: 'child-a',
          messageOrder: 900_000,
          parentId: 'parent-z',
          role: 'assistant',
          updatedAt: 1715186015053,
        },
        {
          content: 'Parent message',
          createdAt: 1715186011586,
          id: 'parent-z',
          messageOrder: 900_001,
          role: 'user',
          updatedAt: 1715186015053,
        },
      ],
    } as any;

    const result = await importer.importData(data);

    expect(result.messages).toEqual({ added: 2, errors: 0, skips: 0 });

    const importedMessages = await db.query.messages.findMany({
      orderBy: (table, { asc }) => asc(table.messageOrder),
      where: eq(messages.userId, userId),
    });

    expect(importedMessages.map(({ clientId }) => clientId)).toEqual(['parent-z', 'child-a']);
    expect(importedMessages.map(({ messageOrder }) => messageOrder)).not.toContain(900_000n);
    expect(importedMessages.map(({ messageOrder }) => messageOrder)).not.toContain(900_001n);
  });
});
