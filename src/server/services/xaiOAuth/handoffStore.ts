import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import { XAI_OAUTH_HANDOFF_CLIENT } from '@lobechat/model-runtime';
import { and, eq, sql } from 'drizzle-orm';

import { oauthHandoffs } from '@/database/schemas/oidc';

export type XaiDeviceHandoffPayload = {
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
  pollOwner?: string;
  pollUntil?: number;
  tokenEndpoint: string;
  userCode: string;
  userId: string;
};

export type XaiDeviceHandoffRow = {
  client: string;
  id: string;
  payload: XaiDeviceHandoffPayload;
};

export type XaiDeviceHandoffStore = {
  claimPoll: (id: string, now: number) => Promise<XaiDeviceHandoffPayload | null>;
  deleteById: (id: string) => Promise<void>;
  deleteIfOwner: (id: string, owner: string) => Promise<boolean>;
  findById: (id: string) => Promise<XaiDeviceHandoffRow | undefined>;
  insert: (row: { client: string; id: string; payload: XaiDeviceHandoffPayload }) => Promise<void>;
  saveIfOwner: (id: string, owner: string, payload: XaiDeviceHandoffPayload) => Promise<boolean>;
};

export const canClaimXaiDevicePoll = (payload: XaiDeviceHandoffPayload, now: number): boolean => {
  if (payload.nextPollAt > now) return false;
  return !payload.pollOwner;
};

export const withoutXaiDevicePollOwner = (
  payload: XaiDeviceHandoffPayload,
  overrides?: Partial<XaiDeviceHandoffPayload>,
): XaiDeviceHandoffPayload => ({
  deviceCode: payload.deviceCode,
  expiresAt: payload.expiresAt,
  intervalMs: payload.intervalMs,
  nextPollAt: payload.nextPollAt,
  tokenEndpoint: payload.tokenEndpoint,
  userCode: payload.userCode,
  userId: payload.userId,
  ...overrides,
});

const asPayload = (value: unknown): XaiDeviceHandoffPayload => value as XaiDeviceHandoffPayload;

const claimWhere = (id: string, now: number) =>
  and(
    eq(oauthHandoffs.id, id),
    eq(oauthHandoffs.client, XAI_OAUTH_HANDOFF_CLIENT),
    sql`COALESCE((${oauthHandoffs.payload}->>'nextPollAt')::bigint, 0) <= ${now}`,
    sql`(${oauthHandoffs.payload}->>'pollOwner' IS NULL OR ${oauthHandoffs.payload}->>'pollOwner' = '')`,
  );

const ownerWhere = (id: string, owner: string) =>
  and(
    eq(oauthHandoffs.id, id),
    eq(oauthHandoffs.client, XAI_OAUTH_HANDOFF_CLIENT),
    sql`${oauthHandoffs.payload}->>'pollOwner' = ${owner}`,
  );

export const createDrizzleXaiDeviceHandoffStore = (
  db: LobeChatDatabase,
): XaiDeviceHandoffStore => ({
  claimPoll: async (id, now) => {
    const current = await db.select().from(oauthHandoffs).where(eq(oauthHandoffs.id, id));
    const row = current[0];
    if (!row || row.client !== XAI_OAUTH_HANDOFF_CLIENT) return null;

    const payload = asPayload(row.payload);
    if (!canClaimXaiDevicePoll(payload, now)) return null;

    const claimed = withoutXaiDevicePollOwner(payload, {
      nextPollAt: now + payload.intervalMs,
      pollOwner: randomUUID(),
    });

    const updated = await db
      .update(oauthHandoffs)
      .set({ payload: claimed })
      .where(claimWhere(id, now))
      .returning({ id: oauthHandoffs.id });

    return updated.length > 0 ? claimed : null;
  },

  deleteById: async (id) => {
    await db
      .delete(oauthHandoffs)
      .where(and(eq(oauthHandoffs.id, id), eq(oauthHandoffs.client, XAI_OAUTH_HANDOFF_CLIENT)));
  },

  deleteIfOwner: async (id, owner) => {
    const removed = await db
      .delete(oauthHandoffs)
      .where(ownerWhere(id, owner))
      .returning({ id: oauthHandoffs.id });
    return removed.length > 0;
  },

  findById: async (id) => {
    const [row] = await db.select().from(oauthHandoffs).where(eq(oauthHandoffs.id, id));
    if (!row || row.client !== XAI_OAUTH_HANDOFF_CLIENT) return undefined;
    return { client: row.client, id: row.id, payload: asPayload(row.payload) };
  },

  insert: async (row) => {
    await db.insert(oauthHandoffs).values(row);
  },

  saveIfOwner: async (id, owner, payload) => {
    const updated = await db
      .update(oauthHandoffs)
      .set({ payload })
      .where(ownerWhere(id, owner))
      .returning({ id: oauthHandoffs.id });
    return updated.length > 0;
  },
});

export const createMemoryXaiDeviceHandoffStore = () => {
  const rows = new Map<string, XaiDeviceHandoffRow>();
  let pendingClaimError: Error | undefined;

  const store: XaiDeviceHandoffStore & {
    failNextClaim: (error: Error) => void;
    getRow: (id: string) => XaiDeviceHandoffRow | undefined;
    seed: (row: XaiDeviceHandoffRow) => void;
  } = {
    claimPoll: async (id, now) => {
      if (pendingClaimError) {
        const error = pendingClaimError;
        pendingClaimError = undefined;
        throw error;
      }

      const row = rows.get(id);
      if (!row || row.client !== XAI_OAUTH_HANDOFF_CLIENT) return null;
      if (!canClaimXaiDevicePoll(row.payload, now)) return null;

      const claimed = withoutXaiDevicePollOwner(row.payload, {
        nextPollAt: now + row.payload.intervalMs,
        pollOwner: randomUUID(),
      });
      rows.set(id, { ...row, payload: claimed });
      return claimed;
    },

    deleteById: async (id) => {
      const row = rows.get(id);
      if (row?.client === XAI_OAUTH_HANDOFF_CLIENT) rows.delete(id);
    },

    deleteIfOwner: async (id, owner) => {
      const row = rows.get(id);
      if (!row || row.client !== XAI_OAUTH_HANDOFF_CLIENT || row.payload.pollOwner !== owner) {
        return false;
      }
      rows.delete(id);
      return true;
    },

    failNextClaim: (error) => {
      pendingClaimError = error;
    },

    findById: async (id) => {
      const row = rows.get(id);
      if (!row || row.client !== XAI_OAUTH_HANDOFF_CLIENT) return undefined;
      return { ...row, payload: { ...row.payload } };
    },

    getRow: (id) => rows.get(id),

    insert: async (row) => {
      rows.set(row.id, { client: row.client, id: row.id, payload: { ...row.payload } });
    },

    saveIfOwner: async (id, owner, payload) => {
      const row = rows.get(id);
      if (!row || row.client !== XAI_OAUTH_HANDOFF_CLIENT || row.payload.pollOwner !== owner) {
        return false;
      }
      rows.set(id, { ...row, payload: { ...payload } });
      return true;
    },

    seed: (row) => {
      rows.set(row.id, { ...row, payload: { ...row.payload } });
    },
  };

  return store;
};
