import { and, eq, isNull } from 'drizzle-orm';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  type NewXaiOAuthTokenItem,
  type XaiOAuthTokenItem,
  xaiOAuthTokens,
} from '@/database/schemas/xaiOAuth';

export type XaiOAuthTokenStore = {
  deleteByUserId: (userId: string) => Promise<void>;
  deleteIfRefreshMatches: (
    userId: string,
    expectedRefreshToken: string,
    lockId?: string,
  ) => Promise<boolean>;
  findByUserId: (userId: string) => Promise<XaiOAuthTokenItem | undefined>;
  releaseRefreshLock: (userId: string, lockId: string) => Promise<void>;
  tryAcquireRefreshLock: (userId: string, lockId: string, ttlMs: number) => Promise<boolean>;
  updateIfRefreshMatches: (
    userId: string,
    expectedRefreshToken: string,
    row: NewXaiOAuthTokenItem,
    lockId?: string,
  ) => Promise<boolean>;
  upsert: (row: NewXaiOAuthTokenItem) => Promise<void>;
};

const tokenUpdateFields = (row: NewXaiOAuthTokenItem) => ({
  accessToken: row.accessToken,
  clientId: row.clientId,
  email: row.email,
  expiresAt: row.expiresAt,
  plan: row.plan,
  refreshLockId: null,
  refreshLockUntil: null,
  refreshToken: row.refreshToken,
  tokenEndpoint: row.tokenEndpoint,
  updatedAt: new Date(),
});

const matchingRefresh = (userId: string, expectedRefreshToken: string, lockId?: string) =>
  lockId
    ? and(
        eq(xaiOAuthTokens.userId, userId),
        eq(xaiOAuthTokens.refreshToken, expectedRefreshToken),
        eq(xaiOAuthTokens.refreshLockId, lockId),
      )
    : and(eq(xaiOAuthTokens.userId, userId), eq(xaiOAuthTokens.refreshToken, expectedRefreshToken));

export const createDrizzleXaiOAuthTokenStore = (db: LobeChatDatabase): XaiOAuthTokenStore => ({
  deleteByUserId: async (userId) => {
    await db.delete(xaiOAuthTokens).where(eq(xaiOAuthTokens.userId, userId));
  },

  deleteIfRefreshMatches: async (userId, expectedRefreshToken, lockId) => {
    const removed = await db
      .delete(xaiOAuthTokens)
      .where(matchingRefresh(userId, expectedRefreshToken, lockId))
      .returning({ id: xaiOAuthTokens.id });

    return removed.length > 0;
  },

  findByUserId: async (userId) => {
    const [record] = await db.select().from(xaiOAuthTokens).where(eq(xaiOAuthTokens.userId, userId));
    return record;
  },

  releaseRefreshLock: async (userId, lockId) => {
    await db
      .update(xaiOAuthTokens)
      .set({
        refreshLockId: null,
        refreshLockUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(xaiOAuthTokens.userId, userId), eq(xaiOAuthTokens.refreshLockId, lockId)));
  },

  tryAcquireRefreshLock: async (userId, lockId, ttlMs) => {
    const now = new Date();
    const updated = await db
      .update(xaiOAuthTokens)
      .set({
        refreshLockId: lockId,
        refreshLockUntil: new Date(now.getTime() + ttlMs),
        updatedAt: now,
      })
      .where(and(eq(xaiOAuthTokens.userId, userId), isNull(xaiOAuthTokens.refreshLockId)))
      .returning({ id: xaiOAuthTokens.id });

    return updated.length > 0;
  },

  updateIfRefreshMatches: async (userId, expectedRefreshToken, row, lockId) => {
    const updated = await db
      .update(xaiOAuthTokens)
      .set(tokenUpdateFields(row))
      .where(matchingRefresh(userId, expectedRefreshToken, lockId))
      .returning({ id: xaiOAuthTokens.id });

    return updated.length > 0;
  },

  upsert: async (row) => {
    const existing = await db
      .select({ id: xaiOAuthTokens.id })
      .from(xaiOAuthTokens)
      .where(eq(xaiOAuthTokens.userId, row.userId));

    if (existing[0]) {
      await db.update(xaiOAuthTokens).set(tokenUpdateFields(row)).where(eq(xaiOAuthTokens.userId, row.userId));
      return;
    }

    await db.insert(xaiOAuthTokens).values(row);
  },
});

export const createMemoryXaiOAuthTokenStore = () => {
  const rows = new Map<string, XaiOAuthTokenItem>();
  let nextId = 1;

  const toRow = (
    row: NewXaiOAuthTokenItem,
    existing?: XaiOAuthTokenItem,
  ): XaiOAuthTokenItem => {
    const now = new Date();
    return {
      accessToken: row.accessToken,
      accessedAt: existing?.accessedAt ?? now,
      clientId: row.clientId,
      createdAt: existing?.createdAt ?? now,
      email: row.email ?? null,
      expiresAt: row.expiresAt,
      id: existing?.id ?? nextId++,
      plan: row.plan ?? null,
      refreshLockId: row.refreshLockId ?? null,
      refreshLockUntil: row.refreshLockUntil ?? null,
      refreshToken: row.refreshToken,
      tokenEndpoint: row.tokenEndpoint ?? null,
      updatedAt: now,
      userId: row.userId,
    };
  };

  const store: XaiOAuthTokenStore & { rows: Map<string, XaiOAuthTokenItem> } = {
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
