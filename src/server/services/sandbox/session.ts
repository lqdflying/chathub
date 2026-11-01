import { createHash } from 'node:crypto';

import { toPersistedConversationSessionId } from '@/server/services/conversationGeneration/inboxSession';
import { DEFAULT_SANDBOX_PROFILE_ID } from '@/tools/sandbox/const';

export interface SandboxConversationScope {
  groupId?: string | null;
  /** Sandbox Hub profile; each profile gets its own sandbox in a conversation. */
  profileId?: string | null;
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
 *
 * The `general` profile hashes the same five values as before profiles
 * existed, so its parked sandboxes are still found. Any other profile adds
 * its id, so profiles never share (or evict) each other's sandbox and each
 * gets its own lock.
 */
export const buildSandboxSessionKey = ({
  groupId,
  profileId,
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
        ...(profileId && profileId !== DEFAULT_SANDBOX_PROFILE_ID ? [profileId] : []),
      ]),
    )
    .digest('hex')
    .slice(0, 32);
