import { describe, expect, it } from 'vitest';

import { splitTokenizerChunks } from './chunks';
import { fallbackTokenCount } from './fallback';

describe('fallbackTokenCount', () => {
  it('counts ASCII at one token per four characters and other code points at one', () => {
    expect(fallbackTokenCount('')).toBe(0);
    expect(fallbackTokenCount('abcd')).toBe(1);
    expect(fallbackTokenCount('abcde')).toBe(2);
    expect(fallbackTokenCount('汉字')).toBe(2);
    expect(fallbackTokenCount('ab汉')).toBe(2);
  });
});

describe('splitTokenizerChunks', () => {
  it('keeps a short string in one chunk and splits a long string under the limit', () => {
    expect(splitTokenizerChunks('hello', 10)).toEqual(['hello']);

    const text = `${'word '.repeat(3000)}tail`;
    const chunks = splitTokenizerChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });
});
