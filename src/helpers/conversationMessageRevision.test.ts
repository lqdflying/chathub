import { describe, expect, it } from 'vitest';

import { createConversationMessageRevision } from './conversationMessageRevision';

describe('createConversationMessageRevision', () => {
  it('is stable when only object identity changes', () => {
    const messages = [
      { content: 'hello', id: 'u1', updatedAt: 1 },
      { content: 'ok', id: 'a1', tools: [{ id: 't1' }], updatedAt: 2 },
    ];

    expect(createConversationMessageRevision(messages)).toBe(
      createConversationMessageRevision([...messages]),
    );
  });

  it('changes when content length or updatedAt changes', () => {
    const first = createConversationMessageRevision([
      { content: 'hello', id: 'u1', updatedAt: 1 },
    ]);
    const grown = createConversationMessageRevision([
      { content: 'hello!', id: 'u1', updatedAt: 1 },
    ]);
    const touched = createConversationMessageRevision([
      { content: 'hello', id: 'u1', updatedAt: 2 },
    ]);

    expect(first).not.toBe(grown);
    expect(first).not.toBe(touched);
  });

  it('does not copy message bodies', () => {
    const huge = 'x'.repeat(50_000);
    const revision = createConversationMessageRevision([{ content: huge, id: 'u1', updatedAt: 1 }]);

    expect(revision.includes(huge)).toBe(false);
    expect(revision).toContain('50000');
  });
});
