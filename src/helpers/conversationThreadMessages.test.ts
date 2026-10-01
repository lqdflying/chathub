import { describe, expect, it } from 'vitest';

import { selectScopedConversationMessages } from './conversationThreadMessages';

const message = (id: string, threadId?: string) =>
  ({ content: id, id, role: 'user', threadId }) as any;

describe('selectScopedConversationMessages', () => {
  const messages = [
    message('main-1'),
    message('main-2'),
    message('child-1', 'thread-a'),
    message('main-3'),
    message('child-2', 'thread-a'),
  ];

  it('includes the continuation prefix and that thread only', () => {
    expect(
      selectScopedConversationMessages({
        messages,
        thread: { id: 'thread-a', sourceMessageId: 'main-2', type: 'continuation' },
        threadId: 'thread-a',
      }).messages.map((item) => item.id),
    ).toEqual(['main-1', 'main-2', 'child-1', 'child-2']);
  });

  it('marks the sample incomplete when the thread source cannot be found', () => {
    const selected = selectScopedConversationMessages({
      messages,
      thread: { id: 'thread-a', type: 'continuation' },
      threadId: 'thread-a',
    });
    expect(selected.complete).toBe(false);
    expect(selected.messages.map((item) => item.id)).toEqual(['child-1', 'child-2']);
  });

  it('uses the source message plus children for a standalone thread', () => {
    const selected = selectScopedConversationMessages({
      messages,
      thread: { id: 'thread-a', sourceMessageId: 'main-2', type: 'standalone' },
      threadId: 'thread-a',
    });
    expect(selected.complete).toBe(true);
    expect(selected.messages.map((item) => item.id)).toEqual(['main-2', 'child-1', 'child-2']);
  });
});
