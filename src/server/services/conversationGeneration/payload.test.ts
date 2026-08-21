import { INBOX_SESSION_ID } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import {
  resolveConversationInboxSessionId,
  toPersistedConversationMessageSessionId,
  toPersistedConversationSessionId,
} from './inboxSession';

describe('resolveConversationInboxSessionId', () => {
  it('uses the public inbox id when the operation has no session', () => {
    expect(resolveConversationInboxSessionId()).toBe(INBOX_SESSION_ID);
    expect(resolveConversationInboxSessionId(null)).toBe(INBOX_SESSION_ID);
  });

  it('keeps an explicit session id', () => {
    expect(resolveConversationInboxSessionId('sess-1')).toBe('sess-1');
  });
});

describe('toPersistedConversationSessionId', () => {
  it('stores inbox, empty, and null as undefined so queries match IS NULL rows', () => {
    expect(toPersistedConversationSessionId()).toBeUndefined();
    expect(toPersistedConversationSessionId(null)).toBeUndefined();
    expect(toPersistedConversationSessionId('')).toBeUndefined();
    expect(toPersistedConversationSessionId(INBOX_SESSION_ID)).toBeUndefined();
  });

  it('keeps a named session id', () => {
    expect(toPersistedConversationSessionId('sess-1')).toBe('sess-1');
  });
});

describe('toPersistedConversationMessageSessionId', () => {
  it('stores inbox, empty, and null as null so MessageModel.matchSession uses IS NULL', () => {
    expect(toPersistedConversationMessageSessionId()).toBeNull();
    expect(toPersistedConversationMessageSessionId(null)).toBeNull();
    expect(toPersistedConversationMessageSessionId('')).toBeNull();
    expect(toPersistedConversationMessageSessionId(INBOX_SESSION_ID)).toBeNull();
  });

  it('keeps a named session id and falls back to groupId only when session is inbox-null', () => {
    expect(toPersistedConversationMessageSessionId('sess-1', 'group-1')).toBe('sess-1');
    expect(toPersistedConversationMessageSessionId(undefined, 'group-1')).toBe('group-1');
    expect(toPersistedConversationMessageSessionId(INBOX_SESSION_ID, undefined)).toBeNull();
    expect(toPersistedConversationMessageSessionId('', '')).toBeNull();
  });
});
