import { createHash } from 'node:crypto';

import { toPersistedConversationSessionId } from '@/server/services/conversationGeneration/inboxSession';

export interface SandboxConversationScope {
  groupId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  userId: string;
}

/**
 * One sandbox scope per conversation, matching the scope input files are
 * gathered from: a portal thread is its own scope, the main topic another, and
 * an agent's messages outside any topic a third. Hashed so no raw ids reach the
 * sandbox server, where the key becomes a container label.
 */
export const buildSandboxSessionKey = ({
  groupId,
  sessionId,
  threadId,
  topicId,
  userId,
}: SandboxConversationScope) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        userId,
        groupId || null,
        toPersistedConversationSessionId(sessionId) ?? null,
        topicId || null,
        threadId || null,
      ]),
    )
    .digest('hex')
    .slice(0, 32);
