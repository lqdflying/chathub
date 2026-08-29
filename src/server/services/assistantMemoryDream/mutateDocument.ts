import type { LobeChatDatabase } from '@lobechat/database';
import type { LobeAgentChatConfig } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { agents } from '@/database/schemas';
import {
  capDreamMemoryDocument,
  deleteDreamMemoryEntry,
  enforceDreamMemoryRetention,
  normalizeAssistantMemoryText,
  normalizeDreamMemoryDocument,
  resolveMemoryDreamMaxEntries,
  updateDreamMemoryEntry,
} from '@/helpers/assistantMemory';

export interface DreamMemoryDocumentMutationResult {
  reason?: string;
  status: 'failed' | 'stale_conflict' | 'success';
}

type AgentSnapshot = {
  assistantMemory: string | null;
  chatConfig: LobeAgentChatConfig;
  updatedAt: Date;
};

const writeAgentIfUnchanged = async (
  db: LobeChatDatabase,
  agentId: string,
  userId: string,
  snapshot: AgentSnapshot,
  patch: {
    assistantMemory?: string | null;
    chatConfig?: LobeAgentChatConfig;
  },
) => {
  const updated = await db
    .update(agents)
    .set(patch)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.userId, userId),
        eq(agents.updatedAt, snapshot.updatedAt),
      ),
    )
    .returning({ id: agents.id });

  return updated.length > 0;
};

const writeAssistantMemoryIfUnchanged = async (
  db: LobeChatDatabase,
  agentId: string,
  userId: string,
  snapshot: AgentSnapshot,
  assistantMemory: string,
) =>
  writeAgentIfUnchanged(db, agentId, userId, snapshot, { assistantMemory });

const loadAgentSnapshot = async (
  db: LobeChatDatabase,
  agentId: string,
  userId: string,
): Promise<AgentSnapshot | null> => {
  const [agent] = await db
    .select({
      assistantMemory: agents.assistantMemory,
      chatConfig: agents.chatConfig,
      updatedAt: agents.updatedAt,
    })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
    .limit(1);

  if (!agent) return null;

  return {
    assistantMemory: agent.assistantMemory,
    chatConfig: (agent.chatConfig ?? {}) as LobeAgentChatConfig,
    updatedAt: agent.updatedAt,
  };
};

const finalizeDreamDocument = (doc: string, maxEntries: number) =>
  capDreamMemoryDocument(enforceDreamMemoryRetention(doc, maxEntries), maxEntries);

export const updateDreamMemoryCardOnServer = async ({
  agentId,
  body,
  dateTag,
  db,
  index,
  match,
  userId,
}: {
  agentId: string;
  body: string;
  dateTag: string;
  db: LobeChatDatabase;
  index: number;
  match: string;
  userId: string;
}): Promise<DreamMemoryDocumentMutationResult> => {
  const snapshot = await loadAgentSnapshot(db, agentId, userId);
  if (!snapshot) return { reason: 'no_agent', status: 'failed' };

  const doc = normalizeDreamMemoryDocument(snapshot.assistantMemory);
  const outcome = updateDreamMemoryEntry(
    doc,
    index,
    match,
    normalizeAssistantMemoryText(body),
    dateTag,
  );
  if ('error' in outcome) return { reason: outcome.error, status: 'failed' };

  const maxEntries = resolveMemoryDreamMaxEntries(snapshot.chatConfig);
  const nextDoc = finalizeDreamDocument(outcome.doc, maxEntries);
  const wrote = await writeAssistantMemoryIfUnchanged(db, agentId, userId, snapshot, nextDoc);
  return wrote ? { status: 'success' } : { reason: 'stale_conflict', status: 'stale_conflict' };
};

export const deleteDreamMemoryCardOnServer = async ({
  agentId,
  dateTag,
  db,
  index,
  match,
  userId,
}: {
  agentId: string;
  dateTag: string;
  db: LobeChatDatabase;
  index: number;
  match: string;
  userId: string;
}): Promise<DreamMemoryDocumentMutationResult> => {
  const snapshot = await loadAgentSnapshot(db, agentId, userId);
  if (!snapshot) return { reason: 'no_agent', status: 'failed' };

  const doc = normalizeDreamMemoryDocument(snapshot.assistantMemory);
  const outcome = deleteDreamMemoryEntry(doc, index, match, dateTag);
  if ('error' in outcome) return { reason: outcome.error, status: 'failed' };

  const maxEntries = resolveMemoryDreamMaxEntries(snapshot.chatConfig);
  const nextDoc = finalizeDreamDocument(outcome.doc, maxEntries);
  const wrote = await writeAssistantMemoryIfUnchanged(db, agentId, userId, snapshot, nextDoc);
  return wrote ? { status: 'success' } : { reason: 'stale_conflict', status: 'stale_conflict' };
};

export const clearDreamMemoryOnServer = async ({
  agentId,
  db,
  userId,
}: {
  agentId: string;
  db: LobeChatDatabase;
  userId: string;
}): Promise<DreamMemoryDocumentMutationResult> => {
  const snapshot = await loadAgentSnapshot(db, agentId, userId);
  if (!snapshot) return { reason: 'no_agent', status: 'failed' };

  const wrote = await writeAssistantMemoryIfUnchanged(db, agentId, userId, snapshot, '');
  return wrote ? { status: 'success' } : { reason: 'stale_conflict', status: 'stale_conflict' };
};

export const applyDreamMemoryRetentionOnServer = async ({
  agentId,
  db,
  maxEntries,
  userId,
}: {
  agentId: string;
  db: LobeChatDatabase;
  maxEntries: number;
  userId: string;
}): Promise<DreamMemoryDocumentMutationResult> => {
  const snapshot = await loadAgentSnapshot(db, agentId, userId);
  if (!snapshot) return { reason: 'no_agent', status: 'failed' };

  const doc = normalizeDreamMemoryDocument(snapshot.assistantMemory);
  const nextDoc = finalizeDreamDocument(doc, maxEntries);
  if (nextDoc === doc) return { status: 'success' };

  const wrote = await writeAssistantMemoryIfUnchanged(db, agentId, userId, snapshot, nextDoc);
  return wrote ? { status: 'success' } : { reason: 'stale_conflict', status: 'stale_conflict' };
};

/** Atomically persist dream-memory settings and apply retention under one CAS write. */
export const saveDreamMemorySettingsOnServer = async ({
  agentId,
  chatConfigPatch,
  db,
  userId,
}: {
  agentId: string;
  chatConfigPatch: Partial<LobeAgentChatConfig>;
  db: LobeChatDatabase;
  userId: string;
}): Promise<DreamMemoryDocumentMutationResult> => {
  const snapshot = await loadAgentSnapshot(db, agentId, userId);
  if (!snapshot) return { reason: 'no_agent', status: 'failed' };

  const nextChatConfig = {
    ...snapshot.chatConfig,
    ...chatConfigPatch,
  } as LobeAgentChatConfig;
  const nextMax = resolveMemoryDreamMaxEntries(nextChatConfig);
  const doc = normalizeDreamMemoryDocument(snapshot.assistantMemory);
  const nextDoc = doc ? finalizeDreamDocument(doc, nextMax) : '';

  const wrote = await writeAgentIfUnchanged(db, agentId, userId, snapshot, {
    assistantMemory: nextDoc,
    chatConfig: nextChatConfig,
  });

  return wrote ? { status: 'success' } : { reason: 'stale_conflict', status: 'stale_conflict' };
};
