import { describe, expect, it } from 'vitest';

import {
  classifyChatImageTaskIdScopeKind,
  decideChatImageTaskCorrelation,
  deriveChatImageTaskId,
  isChatImageTaskIdProvenanceValid,
  listChatImageTaskIdScopeAliases,
  matchChatImageTaskIdScope,
  normalizeChatImageTaskAttempt,
} from './chatImageTaskId';

describe('chatImageTaskId', () => {
  const scope = 'user:account-a';
  const messageId = 'message-1';

  it('is stable for the same user/message/index/attempt tuple', () => {
    expect(deriveChatImageTaskId(scope, messageId, 0, 0)).toBe(
      deriveChatImageTaskId(scope, messageId, 0, 0),
    );
  });

  it('changes when the authenticated user, message, index, or attempt changes', () => {
    const base = deriveChatImageTaskId(scope, messageId, 0, 0);
    expect(deriveChatImageTaskId('user:account-b', messageId, 0, 0)).not.toBe(base);
    expect(deriveChatImageTaskId(scope, 'message-2', 0, 0)).not.toBe(base);
    expect(deriveChatImageTaskId(scope, messageId, 1, 0)).not.toBe(base);
    expect(deriveChatImageTaskId(scope, messageId, 0, 1)).not.toBe(base);
    expect(deriveChatImageTaskId('local', messageId, 0, 0)).not.toBe(base);
  });

  it('treats a missing attempt as 0 and rejects a garbled attempt', () => {
    expect(normalizeChatImageTaskAttempt(undefined)).toBe(0);
    expect(normalizeChatImageTaskAttempt(null)).toBe(0);
    expect(normalizeChatImageTaskAttempt(2)).toBe(2);
    expect(normalizeChatImageTaskAttempt(1.5)).toBeUndefined();
    expect(normalizeChatImageTaskAttempt('0')).toBeUndefined();
    expect(normalizeChatImageTaskAttempt(-1)).toBeUndefined();
  });

  it('accepts only the id derived for that exact tuple', () => {
    const taskId = deriveChatImageTaskId(scope, messageId, 0, 1);
    expect(isChatImageTaskIdProvenanceValid(scope, messageId, 0, taskId, 1)).toBe(true);
    expect(isChatImageTaskIdProvenanceValid(scope, messageId, 0, taskId, 0)).toBe(false);
    expect(isChatImageTaskIdProvenanceValid('user:account-b', messageId, 0, taskId, 1)).toBe(false);
    expect(isChatImageTaskIdProvenanceValid(scope, messageId, 0, taskId, undefined)).toBe(false);
  });

  it('does not authorize a victim UUID embedded in caller-owned content', () => {
    const victimId = deriveChatImageTaskId('user:account-b', messageId, 0, 0);
    expect(
      decideChatImageTaskCorrelation({
        index: 0,
        item: { taskId: victimId },
        messageId,
        taskId: victimId,
        userScopes: [scope],
      }),
    ).toBe('unproven');
  });

  it('authorizes this caller local, anonymous, and mapped-owner aliases', () => {
    const message = 'message-1';
    const localId = deriveChatImageTaskId('local', message, 0, 0);
    const anonymousId = deriveChatImageTaskId('anonymous', message, 0, 0);
    const mappedId = deriveChatImageTaskId('user:mapped-db', message, 0, 0);
    const aliases = listChatImageTaskIdScopeAliases({
      authenticatedScope: 'user:clerk-raw',
      rawAuthUserId: 'clerk-raw',
      userId: 'mapped-db',
    });
    expect(aliases).toEqual(['user:clerk-raw', 'user:mapped-db', 'local', 'anonymous', 'guest']);
    expect(
      decideChatImageTaskCorrelation({
        index: 0,
        item: { taskId: localId },
        messageId: message,
        taskId: localId,
        userScopes: aliases,
      }),
    ).toBe('authorized');
    expect(
      decideChatImageTaskCorrelation({
        index: 0,
        item: { taskId: anonymousId },
        messageId: message,
        taskId: anonymousId,
        userScopes: aliases,
      }),
    ).toBe('authorized');
    expect(
      decideChatImageTaskCorrelation({
        index: 0,
        item: { taskId: mappedId },
        messageId: message,
        taskId: mappedId,
        userScopes: aliases,
      }),
    ).toBe('authorized');
    expect(classifyChatImageTaskIdScopeKind('local', {})).toBe('local');
    expect(
      classifyChatImageTaskIdScopeKind('user:mapped-db', {
        rawAuthUserId: 'clerk-raw',
        userId: 'mapped-db',
      }),
    ).toBe('mapped');
    expect(matchChatImageTaskIdScope(aliases, message, 0, localId, 0)).toBe('local');
    expect(
      matchChatImageTaskIdScope(
        aliases,
        message,
        0,
        deriveChatImageTaskId('user:account-b', message, 0, 0),
        0,
      ),
    ).toBeUndefined();
  });

  it('authorizes attempt 0 and a later attempt when the derived id matches', () => {
    const attempt0 = deriveChatImageTaskId(scope, messageId, 0, 0);
    const attempt2 = deriveChatImageTaskId(scope, messageId, 0, 2);
    expect(
      decideChatImageTaskCorrelation({
        index: 0,
        item: { taskId: attempt0 },
        messageId,
        taskId: attempt0,
        userScopes: [scope],
      }),
    ).toBe('authorized');
    expect(
      decideChatImageTaskCorrelation({
        index: 0,
        item: { taskAttempt: 2, taskId: attempt2 },
        messageId,
        taskId: attempt2,
        userScopes: [scope],
      }),
    ).toBe('authorized');
  });

  it('classifies stopped and resolved after provenance succeeds', () => {
    const taskId = deriveChatImageTaskId(scope, messageId, 0, 0);
    expect(
      decideChatImageTaskCorrelation({
        index: 0,
        item: { taskCancelled: true, taskId },
        messageId,
        taskId,
        userScopes: [scope],
      }),
    ).toBe('stopped');
    expect(
      decideChatImageTaskCorrelation({
        index: 0,
        item: { imageId: 'img', taskId },
        messageId,
        taskId,
        userScopes: [scope],
      }),
    ).toBe('resolved');
  });
});
