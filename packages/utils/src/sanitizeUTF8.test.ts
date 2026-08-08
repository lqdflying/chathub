import { describe, expect, it } from 'vitest';

import { sanitizeUTF8, sanitizeUTF8Deep } from './sanitizeUTF8';

describe('UTF-8 Sanitization', () => {
  it('removes null bytes', () => {
    const input = 'test\u0000string';
    expect(sanitizeUTF8(input)).toBe('teststring');
  });

  it.each(['\uD800', '\uDFFF'])('removes a lone surrogate %j', (loneSurrogate) => {
    expect(sanitizeUTF8(`test${loneSurrogate}string`)).toBe('teststring');
  });

  it('removes invalid UTF-8 content', () => {
    const input = '\u0002\u0000\u0000\u0002�{\\"error\\":{\\"code\\":\\"resource_exhausted\\",';
    expect(sanitizeUTF8(input)).toBe('{\\"error\\":{\\"code\\":\\"resource_exhausted\\",');
  });

  it('preserves valid BMP and non-BMP characters', () => {
    expect(sanitizeUTF8('你好，世界！ A😀B')).toBe('你好，世界！ A😀B');
  });
});

describe('Deep UTF-8 Sanitization', () => {
  it('sanitizes nested strings and record keys', () => {
    expect(
      sanitizeUTF8Deep({
        'bad\u0000key': ['A😀B', { error: 'invalid\u0000value', lone: '\uD800' }],
        'title': 'Valid 😀 title',
      }),
    ).toEqual({
      badkey: ['A😀B', { error: 'invalidvalue', lone: '' }],
      title: 'Valid 😀 title',
    });
  });

  it('preserves non-string primitives and non-plain objects', () => {
    const createdAt = new Date('2026-08-08T00:00:00Z');
    const value = {
      createdAt,
      enabled: true,
      missing: null,
      page: 1,
    };

    const result = sanitizeUTF8Deep(value);

    expect(result).toEqual(value);
    expect(result.createdAt).toBe(createdAt);
  });
});
