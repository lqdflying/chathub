import { describe, expect, it } from 'vitest';

import { conversationGenerationIdempotencyKey, conversationGenerationRequestKey } from '../conversationGenerationIdempotency';

describe('conversationGenerationIdempotencyKey', () => {
  it('joins stable request parts', () => {
    expect(conversationGenerationIdempotencyKey('chat', 'msg-123456')).toBe('chat:msg-123456');
  });

  it('scopes later actions with a distinct request id', () => {
    const first = conversationGenerationRequestKey('group-supervisor', 'req-a', 'group-1', 'topic-1');
    const lostResponse = conversationGenerationRequestKey(
      'group-supervisor',
      'req-a',
      'group-1',
      'topic-1',
    );
    const laterMessage = conversationGenerationRequestKey(
      'group-supervisor',
      'req-b',
      'group-1',
      'topic-1',
    );
    expect(first).toBe(lostResponse);
    expect(laterMessage).not.toBe(first);
    expect(first).toContain('req-a');
  });

  it('stays within the enqueue schema length', () => {
    const key = conversationGenerationIdempotencyKey('compaction', 'topic-1', 'x'.repeat(400));
    expect(key.length).toBeLessThanOrEqual(180);
    expect(key.length).toBeGreaterThanOrEqual(8);
  });
});
