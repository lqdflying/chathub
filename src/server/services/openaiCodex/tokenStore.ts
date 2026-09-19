import { and, eq } from 'drizzle-orm';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  type NewOpenAICodexOAuthTokenItem,
  type OpenAICodexOAuthTokenItem,
  openaiCodexOAuthTokens,
} from '@/database/schemas/openaiCodexOAuth';

export type OpenAICodexTokenStore = {
  deleteByUserId: (userId: string) => Promise<void>;
  deleteIfRefreshMatches: (userId: string, expectedRefreshToken: string) => Promise<boolean>;
  findByUserId: (userId: string) => Promise<OpenAICodexOAuthTokenItem | undefined>;
  updateIfRefreshMatches: (
    userId: string,
    expectedRefreshToken: string,
    row: NewOpenAICodexOAuthTokenItem,
  ) => Promise<boolean>;
  upsert: (row: NewOpenAICodexOAuthTokenItem) => Promise<void>;
};

const tokenUpdateFields = (row: NewOpenAICodexOAuthTokenItem) => ({
  accessToken: row.accessToken,
  accountId: row.accountId,
  chatgptPlanType: row.chatgptPlanType,
  clientId: row.clientId,
  email: row.email,
  expiresAt: row.expiresAt,
  refreshToken: row.refreshToken,
  updatedAt: new Date(),
});

export const createDrizzleOpenAICodexTokenStore = (
  db: LobeChatDatabase,
): OpenAICodexTokenStore => ({
  deleteByUserId: async (userId) => {
    await db.delete(openaiCodexOAuthTokens).where(eq(openaiCodexOAuthTokens.userId, userId));
  },

  deleteIfRefreshMatches: async (userId, expectedRefreshToken) => {
    const removed = await db
      .delete(openaiCodexOAuthTokens)
      .where(
        and(
          eq(openaiCodexOAuthTokens.userId, userId),
          eq(openaiCodexOAuthTokens.refreshToken, expectedRefreshToken),
        ),
      )
      .returning({ id: openaiCodexOAuthTokens.id });

    return removed.length > 0;
  },

  findByUserId: async (userId) => {
    const [record] = await db
      .select()
      .from(openaiCodexOAuthTokens)
      .where(eq(openaiCodexOAuthTokens.userId, userId));

    return record;
  },

  updateIfRefreshMatches: async (userId, expectedRefreshToken, row) => {
    const updated = await db
      .update(openaiCodexOAuthTokens)
      .set(tokenUpdateFields(row))
      .where(
        and(
          eq(openaiCodexOAuthTokens.userId, userId),
          eq(openaiCodexOAuthTokens.refreshToken, expectedRefreshToken),
        ),
      )
      .returning({ id: openaiCodexOAuthTokens.id });

    return updated.length > 0;
  },

  upsert: async (row) => {
    const existing = await db
      .select({ id: openaiCodexOAuthTokens.id })
      .from(openaiCodexOAuthTokens)
      .where(eq(openaiCodexOAuthTokens.userId, row.userId));

    if (existing[0]) {
      await db
        .update(openaiCodexOAuthTokens)
        .set(tokenUpdateFields(row))
        .where(eq(openaiCodexOAuthTokens.userId, row.userId));
      return;
    }

    await db.insert(openaiCodexOAuthTokens).values(row);
  },
});

export const createMemoryOpenAICodexTokenStore = () => {
  const rows = new Map<string, OpenAICodexOAuthTokenItem>();
  let nextId = 1;

  const toRow = (
    row: NewOpenAICodexOAuthTokenItem,
    existing?: OpenAICodexOAuthTokenItem,
  ): OpenAICodexOAuthTokenItem => {
    const now = new Date();
    return {
      accessToken: row.accessToken,
      accessedAt: existing?.accessedAt ?? now,
      accountId: row.accountId,
      chatgptPlanType: row.chatgptPlanType ?? null,
      clientId: row.clientId,
      createdAt: existing?.createdAt ?? now,
      email: row.email ?? null,
      expiresAt: row.expiresAt,
      id: existing?.id ?? nextId++,
      refreshToken: row.refreshToken,
      updatedAt: now,
      userId: row.userId,
    };
  };

  const store: OpenAICodexTokenStore & { rows: Map<string, OpenAICodexOAuthTokenItem> } = {
    deleteByUserId: async (userId) => {
      rows.delete(userId);
    },
    deleteIfRefreshMatches: async (userId, expectedRefreshToken) => {
      const existing = rows.get(userId);
      if (!existing || existing.refreshToken !== expectedRefreshToken) return false;
      rows.delete(userId);
      return true;
    },
    findByUserId: async (userId) => rows.get(userId),
    rows,
    updateIfRefreshMatches: async (userId, expectedRefreshToken, row) => {
      const existing = rows.get(userId);
      if (!existing || existing.refreshToken !== expectedRefreshToken) return false;
      rows.set(userId, toRow(row, existing));
      return true;
    },
    upsert: async (row) => {
      rows.set(row.userId, toRow(row, rows.get(row.userId)));
    },
  };

  return store;
};
