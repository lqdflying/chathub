import { INBOX_SESSION_ID } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { resolveConversationInboxSessionId } from './inboxSession';

describe('resolveConversationInboxSessionId', () => {
  it('uses the public inbox id when the operation has no session', () => {
    expect(resolveConversationInboxSessionId()).toBe(INBOX_SESSION_ID);
    expect(resolveConversationInboxSessionId(null)).toBe(INBOX_SESSION_ID);
  });

  it('keeps an explicit session id', () => {
    expect(resolveConversationInboxSessionId('sess-1')).toBe('sess-1');
  });
});
