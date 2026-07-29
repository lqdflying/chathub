import { describe, expect, it } from 'vitest';

import { parseDataUri } from './uriParser';

describe('parseDataUri', () => {
  it('should parse a valid data URI', () => {
    const dataUri = 'data:image/png;base64,abc';
    const result = parseDataUri(dataUri);
    expect(result).toEqual({ base64: 'abc', mimeType: 'image/png', type: 'base64' });
  });

  it('should expose the shared stack-safe parser through model runtime', () => {
    const base64 = 'A'.repeat(4 * 1024 * 1024);
    const result = parseDataUri(`data:image/webp;base64,${base64}`);

    expect(result).toEqual({ base64, mimeType: 'image/webp', type: 'base64' });
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
