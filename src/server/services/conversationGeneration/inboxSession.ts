import { INBOX_SESSION_ID } from '@lobechat/const';

export const resolveConversationInboxSessionId = (sessionId?: string | null) =>
  sessionId || INBOX_SESSION_ID;
