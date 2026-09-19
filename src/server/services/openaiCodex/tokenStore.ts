import { and, eq, isNull } from 'drizzle-orm';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  type NewOpenAICodexOAuthTokenItem,
  type OpenAICodexOAuthTokenItem,
  openaiCodexOAuthTokens,
} from '@/database/schemas/openaiCodexOAuth';

export type OpenAICodexTokenStore = {
  deleteByUserId: (userId: string) => Promise<void>;
  deleteIfRefreshMatches: (
    userId: string,
    expectedRefreshToken: string,
    lockId?: string,
  ) => Promise<boolean>;
  findByUserId: (userId: string) => Promise<OpenAICodexOAuthTokenItem | undefined>;
  releaseRefreshLock: (userId: string, lockId: string) => Promise<void>;
  tryAcquireRefreshLock: (userId: string, lockId: string, ttlMs: number) => Promise<boolean>;
  updateIfRefreshMatches: (
    userId: string,
    expectedRefreshToken: string,
    row: NewOpenAICodexOAuthTokenItem,
    lockId?: string,
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
  refreshLockId: null,
  refreshLockUntil: null,
  refreshToken: row.refreshToken,
  updatedAt: new Date(),
});

const matchingRefresh = (userId: string, expectedRefreshToken: string, lockId?: string) =>
  lockId
    ? and(
        eq(openaiCodexOAuthTokens.userId, userId),
        eq(openaiCodexOAuthTokens.refreshToken, expectedRefreshToken),
        eq(openaiCodexOAuthTokens.refreshLockId, lockId),
      )
    : and(
        eq(openaiCodexOAuthTokens.userId, userId),
        eq(openaiCodexOAuthTokens.refreshToken, expectedRefreshToken),
      );

export const createDrizzleOpenAICodexTokenStore = (
  db: LobeChatDatabase,
): OpenAICodexTokenStore => ({
  deleteByUserId: async (userId) => {
    await db.delete(openaiCodexOAuthTokens).where(eq(openaiCodexOAuthTokens.userId, userId));
  },

  deleteIfRefreshMatches: async (userId, expectedRefreshToken, lockId) => {
    const removed = await db
      .delete(openaiCodexOAuthTokens)
      .where(matchingRefresh(userId, expectedRefreshToken, lockId))
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

  releaseRefreshLock: async (userId, lockId) => {
    await db
      .update(openaiCodexOAuthTokens)
      .set({
        refreshLockId: null,
        refreshLockUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(openaiCodexOAuthTokens.userId, userId),
          eq(openaiCodexOAuthTokens.refreshLockId, lockId),
        ),
      );
  },

  tryAcquireRefreshLock: async (userId, lockId, ttlMs) => {
    const now = new Date();
    const updated = await db
      .update(openaiCodexOAuthTokens)
      .set({
        refreshLockId: lockId,
        refreshLockUntil: new Date(now.getTime() + ttlMs),
        updatedAt: now,
      })
      .where(
        and(eq(openaiCodexOAuthTokens.userId, userId), isNull(openaiCodexOAuthTokens.refreshLockId)),
      )
      .returning({ id: openaiCodexOAuthTokens.id });

    return updated.length > 0;
  },

  updateIfRefreshMatches: async (userId, expectedRefreshToken, row, lockId) => {
    const updated = await db
      .update(openaiCodexOAuthTokens)
      .set(tokenUpdateFields(row))
      .where(matchingRefresh(userId, expectedRefreshToken, lockId))
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
      refreshLockId: row.refreshLockId ?? null,
      refreshLockUntil: row.refreshLockUntil ?? null,
      refreshToken: row.refreshToken,
      updatedAt: now,
      userId: row.userId,
    };
  };

  const store: OpenAICodexTokenStore & { rows: Map<string, OpenAICodexOAuthTokenItem> } = {
    deleteByUserId: async (userId) => {
      rows.delete(userId);
    },
    deleteIfRefreshMatches: async (userId, expectedRefreshToken, lockId) => {
      const existing = rows.get(userId);
      if (!existing || existing.refreshToken !== expectedRefreshToken) return false;
      if (lockId && existing.refreshLockId !== lockId) return false;
      rows.delete(userId);
      return true;
    },
    findByUserId: async (userId) => rows.get(userId),
    releaseRefreshLock: async (userId, lockId) => {
      const existing = rows.get(userId);
      if (!existing || existing.refreshLockId !== lockId) return;
      rows.set(userId, {
        ...existing,
        refreshLockId: null,
        refreshLockUntil: null,
        updatedAt: new Date(),
      });
    },
    rows,
    tryAcquireRefreshLock: async (userId, lockId, ttlMs) => {
      const existing = rows.get(userId);
      if (!existing || existing.refreshLockId) return false;
      const now = Date.now();
      rows.set(userId, {
        ...existing,
        refreshLockId: lockId,
        refreshLockUntil: new Date(now + ttlMs),
        updatedAt: new Date(now),
      });
      return true;
    },
    updateIfRefreshMatches: async (userId, expectedRefreshToken, row, lockId) => {
      const existing = rows.get(userId);
      if (!existing || existing.refreshToken !== expectedRefreshToken) return false;
      if (lockId && existing.refreshLockId !== lockId) return false;
      rows.set(userId, toRow({ ...row, refreshLockId: null, refreshLockUntil: null }, existing));
      return true;
    },
    upsert: async (row) => {
      rows.set(
        row.userId,
        toRow({ ...row, refreshLockId: null, refreshLockUntil: null }, rows.get(row.userId)),
      );
    },
  };

  return store;
};
