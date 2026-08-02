import { describe, expect, it } from 'vitest';

import { metadata } from './layout';

describe('Discover metadata', () => {
  it('keeps direct routes available without search indexing', () => {
    expect(metadata.robots).toEqual({ follow: true, index: false });
  });
});
