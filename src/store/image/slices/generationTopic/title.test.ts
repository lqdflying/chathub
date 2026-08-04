import { describe, expect, it } from 'vitest';

import { normalizeGenerationTopicTitle } from './title';

describe('normalizeGenerationTopicTitle', () => {
  it.each([
    ['**Flying TV**', 'Flying TV'],
    ['__Super Notebook__', 'Super Notebook'],
    ['***Triple emphasis***', 'Triple emphasis'],
    ['  ** Spaced title **  ', 'Spaced title'],
  ])('removes surrounding Markdown emphasis from %s', (title, expected) => {
    expect(normalizeGenerationTopicTitle(title)).toBe(expected);
  });

  it.each([
    ['Plain title', 'Plain title'],
    ['AC**DC', 'AC**DC'],
    ['**Unclosed title', '**Unclosed title'],
  ])('preserves non-wrapper title text in %s', (title, expected) => {
    expect(normalizeGenerationTopicTitle(title)).toBe(expected);
  });
});
