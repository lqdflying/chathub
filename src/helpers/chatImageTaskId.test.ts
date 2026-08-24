import { describe, expect, it } from 'vitest';

import {
  classifyChatImageTaskIdScopeKind,
  decideChatImageTaskCorrelation,
  deriveChatImageTaskId,
  isChatImageTaskIdProvenanceValid,
  listChatImageTaskIdScopeAliases,
  matchChatImageTaskIdScope,
  mergeChatImageToolContent,
  mergeChatImageToolItems,
  normalizeChatImageTaskAttempt,
  preserveChatImageToolContentOnFetch,
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

  it('keeps imageId and taskId when a later fetch returns prompt-only tiles', () => {
    const incoming = mergeChatImageToolContent(
      JSON.stringify([{ prompt: 'a watercolor apple' }]),
      JSON.stringify([
        {
          imageId: 'file-1',
          prompt: 'a watercolor apple',
          taskId: '11111111-2222-4333-8444-555555555555',
        },
      ]),
    );
    expect(incoming).toContain('"imageId":"file-1"');
    expect(incoming).toContain('"taskId":"11111111-2222-4333-8444-555555555555"');
    expect(JSON.parse(incoming)[0].prompt).toBe('a watercolor apple');
  });

  it('does not restore a Stop mark onto a restamped Retry attempt', () => {
    const stopped = deriveChatImageTaskId(scope, messageId, 0, 0);
    const retried = deriveChatImageTaskId(scope, messageId, 0, 1);
    const merged = mergeChatImageToolItems(
      [{ prompt: 'p', taskAttempt: 1, taskId: retried }],
      [{ prompt: 'p', taskCancelled: true, taskId: stopped }],
    );
    expect(merged[0]?.taskId).toBe(retried);
    expect(merged[0]?.taskCancelled).toBeUndefined();
  });

  it('does not let a stale Stop snapshot overwrite a newer Retry tuple', () => {
    const stopped = deriveChatImageTaskId(scope, messageId, 0, 0);
    const retried = deriveChatImageTaskId(scope, messageId, 0, 1);
    const merged = mergeChatImageToolItems(
      [{ prompt: 'p', taskAttempt: 0, taskCancelled: true, taskFence: 1, taskId: stopped }],
      [{ prompt: 'p', taskAttempt: 1, taskFence: 2, taskId: retried }],
    );
    expect(merged[0]).toMatchObject({
      prompt: 'p',
      taskAttempt: 1,
      taskFence: 2,
      taskId: retried,
    });
    expect(merged[0]?.taskCancelled).toBeUndefined();
  });

  it('does not attach an older attempt file onto a newer Retry tuple', () => {
    const stopped = deriveChatImageTaskId(scope, messageId, 0, 0);
    const retried = deriveChatImageTaskId(scope, messageId, 0, 1);
    const merged = mergeChatImageToolItems(
      [{ imageId: 'file-attempt-0', prompt: 'p', taskAttempt: 0, taskId: stopped }],
      [{ prompt: 'p', taskAttempt: 1, taskId: retried }],
    );
    expect(merged[0]?.taskId).toBe(retried);
    expect(merged[0]?.imageId).toBeUndefined();
  });

  it('keeps a live same-attempt alias instead of reviving a stopped predecessor', () => {
    const stopped = deriveChatImageTaskId('local', messageId, 0, 0);
    const live = deriveChatImageTaskId(scope, messageId, 0, 0);
    const merged = mergeChatImageToolItems(
      [{ prompt: 'p', taskAttempt: 0, taskCancelled: true, taskId: stopped }],
      [{ prompt: 'p', taskAttempt: 0, taskId: live }],
    );
    expect(merged[0]?.taskId).toBe(live);
    expect(merged[0]?.taskCancelled).toBeUndefined();
  });

  it('preserves chat Image tool content on fetch without touching other roles', () => {
    const existing = [
      {
        content: JSON.stringify([{ imageId: 'file-keep', prompt: 'p1', taskId: 'task-keep' }]),
        id: 'tool-1',
        plugin: { apiName: 'text2image', identifier: 'lobe-image-designer' },
        role: 'tool',
      },
      { content: 'hello', id: 'user-1', role: 'user' },
    ];
    const incoming = [
      {
        content: JSON.stringify([{ prompt: 'p1' }]),
        id: 'tool-1',
        plugin: { apiName: 'text2image', identifier: 'lobe-image-designer' },
        role: 'tool',
      },
      { content: 'hello', id: 'user-1', role: 'user' },
      { content: 'summary', id: 'asst-1', role: 'assistant' },
    ];
    const merged = preserveChatImageToolContentOnFetch(incoming, existing);
    expect(JSON.parse(merged[0]?.content ?? '')[0]).toMatchObject({
      imageId: 'file-keep',
      prompt: 'p1',
      taskId: 'task-keep',
    });
    expect(merged[1]?.content).toBe('hello');
    expect(merged[2]?.content).toBe('summary');
  });

  it('merges chat Image tool content when the fetch row omitted plugin', () => {
    const existing = [
      {
        content: JSON.stringify([{ imageId: 'file-keep', prompt: 'p1', taskId: 'task-keep' }]),
        id: 'tool-1',
        plugin: { apiName: 'text2image', identifier: 'lobe-image-designer' },
        role: 'tool',
      },
    ];
    const incoming = [
      {
        content: JSON.stringify([{ prompt: 'p1' }]),
        id: 'tool-1',
        role: 'tool',
      },
    ];
    const merged = preserveChatImageToolContentOnFetch(incoming, existing);
    expect(JSON.parse(merged[0]?.content ?? '')[0]).toMatchObject({
      imageId: 'file-keep',
      prompt: 'p1',
      taskId: 'task-keep',
    });
  });

  it('keeps a previous imageList when the fetch row is prompt-only', () => {
    const existing = [
      {
        content: JSON.stringify([{ prompt: 'p1' }]),
        id: 'tool-1',
        imageList: [{ id: 'file-linked' }],
        role: 'tool',
      },
    ];
    const incoming = [
      {
        content: JSON.stringify([{ prompt: 'p1' }]),
        id: 'tool-1',
        role: 'tool',
      },
    ];
    const merged = preserveChatImageToolContentOnFetch(incoming, existing);
    expect(merged[0]?.imageList).toEqual([{ id: 'file-linked' }]);
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
