import { describe, expect, it } from 'vitest';

import { sortMessagesParentFirst } from './sortMessagesParentFirst';

describe('sortMessagesParentFirst', () => {
  it('preserves source order between independent turns with tied timestamps', () => {
    const tiedCreatedAt = new Date('2024-01-01T00:00:00.000Z');
    const messages = [
      { createdAt: tiedCreatedAt, id: 'turn-z' },
      { createdAt: tiedCreatedAt, id: 'reply-z', parentId: 'turn-z' },
      { createdAt: tiedCreatedAt, id: 'turn-a' },
      { createdAt: tiedCreatedAt, id: 'reply-a', parentId: 'turn-a' },
    ];

    const sortedMessages = sortMessagesParentFirst(messages);

    expect(sortedMessages.map(({ id }) => id)).toEqual([
      'turn-z',
      'reply-z',
      'turn-a',
      'reply-a',
    ]);
  });

  it('moves a tied child behind its parent without reordering later turns', () => {
    const tiedCreatedAt = new Date('2024-01-01T00:00:00.000Z');
    const messages = [
      { createdAt: tiedCreatedAt, id: 'reply-z', parentId: 'turn-z' },
      { createdAt: tiedCreatedAt, id: 'turn-z' },
      { createdAt: tiedCreatedAt, id: 'turn-a' },
      { createdAt: tiedCreatedAt, id: 'reply-a', parentId: 'turn-a' },
    ];

    const sortedMessages = sortMessagesParentFirst(messages);

    expect(sortedMessages.map(({ id }) => id)).toEqual([
      'turn-z',
      'reply-z',
      'turn-a',
      'reply-a',
    ]);
  });

  it('sorts large independent message sets without quadratic queue work', () => {
    const tiedCreatedAt = new Date('2024-01-01T00:00:00.000Z');
    const messages = Array.from({ length: 5000 }, (_, sourceIndex) => ({
      createdAt: tiedCreatedAt,
      id: `root-${sourceIndex.toString().padStart(5, '0')}`,
    }));
    const startedAt = performance.now();

    const sortedMessages = sortMessagesParentFirst(messages);

    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(sortedMessages).toEqual(messages);
  });
});
