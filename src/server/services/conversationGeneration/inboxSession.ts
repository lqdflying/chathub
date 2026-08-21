import { INBOX_SESSION_ID } from '@lobechat/const';

/** Public inbox id for UI / InboxGuide. Empty and null map to inbox. */
export const resolveConversationInboxSessionId = (sessionId?: string | null) =>
  sessionId || INBOX_SESSION_ID;

/**
 * Persist and query inbox rows as NULL, matching MessageModel.matchSession.
 * Callers that store `sessionId: 'inbox'` would otherwise query
 * `eq(sessionId, 'inbox')` and miss every inbox message (`sessionId IS NULL`).
 */
export const toPersistedConversationSessionId = (sessionId?: string | null) => {
  if (!sessionId || sessionId === INBOX_SESSION_ID) return undefined;
  return sessionId;
};

/** Message inserts: inbox/`''` become SQL NULL, matching `MessageModel.matchSession`. */
export const toPersistedConversationMessageSessionId = (
  sessionId?: string | null,
  groupId?: string | null,
) => toPersistedConversationSessionId(sessionId) ?? (groupId || null);
