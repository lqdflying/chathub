import { describe, expect, it } from 'vitest';

import { composeSystemRole } from './composeSystemRole';

describe('composeSystemRole', () => {
  it('places the general instruction before the assistant role', () => {
    expect(composeSystemRole(' Follow the style guide. ', 'You are a teacher.')).toBe(
      'Follow the style guide.\n\nYou are a teacher.',
    );
  });

  it('omits empty sections without adding extra separators', () => {
    expect(composeSystemRole('  ', 'You are a teacher.')).toBe('You are a teacher.');
    expect(composeSystemRole('Follow the style guide.', '  ')).toBe('Follow the style guide.');
    expect(composeSystemRole('  ', '\n')).toBeUndefined();
  });
});
