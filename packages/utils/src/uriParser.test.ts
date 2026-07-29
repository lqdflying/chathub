import { describe, expect, it } from 'vitest';

import { parseDataUri } from './uriParser';

describe('parseDataUri', () => {
  it('should parse a valid data URI', () => {
    const dataUri = 'data:image/png;base64,abc';
    const result = parseDataUri(dataUri);
    expect(result).toEqual({ base64: 'abc', mimeType: 'image/png', type: 'base64' });
  });

  it.each([
    ['empty payload', 'data:image/png;base64,'],
    ['media type parameter', 'data:image/png;charset=utf-8;base64,abc'],
    ['malformed marker', 'data:image/png;base64;abc'],
    ['embedded line terminator', 'data:image/png;base64,ab\ncd'],
    ['trailing line terminator', 'data:image/png;base64,abc\n'],
  ])('should preserve URL fallback for a data URI with %s', (_, dataUri) => {
    expect(parseDataUri(dataUri)).toEqual({ base64: null, mimeType: null, type: 'url' });
  });

  it('should parse a multi-megabyte data URI through a nested call stack', () => {
    const base64 = 'A'.repeat(12 * 1024 * 1024);
    const dataUri = `data:image/png;base64,${base64}`;

    const parseThroughNestedCalls = (remainingCalls: number): ReturnType<typeof parseDataUri> => {
      if (remainingCalls === 0) return parseDataUri(dataUri);

      return parseThroughNestedCalls(remainingCalls - 1);
    };

    expect(parseThroughNestedCalls(256)).toEqual({
      base64,
      mimeType: 'image/png',
      type: 'base64',
    });
  });

  it('should parse a valid URL', () => {
    const url = 'https://example.com/image.jpg';
    const result = parseDataUri(url);
    expect(result).toEqual({ base64: null, mimeType: null, type: 'url' });
  });

  it('should return null for an invalid input', () => {
    const invalidInput = 'invalid-data';
    const result = parseDataUri(invalidInput);
    expect(result).toEqual({ base64: null, mimeType: null, type: null });
  });

  it('should handle an empty input', () => {
    const emptyInput = '';
    const result = parseDataUri(emptyInput);
    expect(result).toEqual({ base64: null, mimeType: null, type: null });
  });
});
