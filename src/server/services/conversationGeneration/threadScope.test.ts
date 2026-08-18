import { describe, expect, it, vi } from 'vitest';

import {
  filterMessagesForConversationThread,
  loadConversationThreadMessages,
} from './threadScope';

const findById = vi.fn();

vi.mock('@/database/models/thread', () => ({
  ThreadModel: class {
    findById = findById;
  },
}));

const message = (
  id: string,
  extras: { content?: string; threadId?: string } = {},
) =>
  ({
    content: extras.content ?? id,
    id,
    role: 'user',
    threadId: extras.threadId,
  }) as any;

describe('filterMessagesForConversationThread', () => {
  const messages = [
    message('main-1'),
    message('main-2'),
    message('thread-a-1', { threadId: 'thread-a' }),
    message('main-3'),
    message('thread-b-1', { threadId: 'thread-b' }),
    message('thread-a-2', { threadId: 'thread-a' }),
  ];

  it('keeps only main-topic messages when no thread is selected', () => {
    expect(filterMessagesForConversationThread(messages).map((item) => item.id)).toEqual([
      'main-1',
      'main-2',
      'main-3',
    ]);
  });

  it('includes the source prefix plus only that thread', () => {
    expect(
      filterMessagesForConversationThread(messages, {
        id: 'thread-a',
        sourceMessageId: 'main-2',
      }).map((item) => item.id),
    ).toEqual(['main-1', 'main-2', 'thread-a-1', 'thread-a-2']);
  });

  it('keeps only that thread when the source message is missing', () => {
    expect(
      filterMessagesForConversationThread(messages, {
        id: 'thread-a',
        sourceMessageId: 'not-in-list',
      }).map((item) => item.id),
    ).toEqual(['thread-a-1', 'thread-a-2']);
  });
});

describe('loadConversationThreadMessages', () => {
  it('loads the thread source and filters like the client selector', async () => {
    findById.mockResolvedValueOnce({ id: 'thread-a', sourceMessageId: 'main-2' });
    const scoped = await loadConversationThreadMessages(
      {} as any,
      'user-1',
      [message('main-1'), message('main-2'), message('thread-a-1', { threadId: 'thread-a' })],
      'thread-a',
    );
    expect(scoped.map((item) => item.id)).toEqual(['main-1', 'main-2', 'thread-a-1']);
  });

  it('treats a missing thread row as the main topic', async () => {
    findById.mockResolvedValueOnce(undefined);
    const scoped = await loadConversationThreadMessages(
      {} as any,
      'user-1',
      [message('main-1'), message('hidden', { threadId: 'thread-a' })],
      'thread-a',
    );
    expect(scoped.map((item) => item.id)).toEqual(['main-1']);
  });
});
