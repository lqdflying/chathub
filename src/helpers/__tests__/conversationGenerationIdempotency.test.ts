import { describe, expect, it } from 'vitest';

import { conversationGenerationIdempotencyKey } from '../conversationGenerationIdempotency';

describe('conversationGenerationIdempotencyKey', () => {
  it('joins stable request parts', () => {
    expect(conversationGenerationIdempotencyKey('chat', 'msg-123456')).toBe('chat:msg-123456');
  });

  it('stays within the enqueue schema length', () => {
    const key = conversationGenerationIdempotencyKey('compaction', 'topic-1', 'x'.repeat(400));
    expect(key.length).toBeLessThanOrEqual(180);
    expect(key.length).toBeGreaterThanOrEqual(8);
  });
});
