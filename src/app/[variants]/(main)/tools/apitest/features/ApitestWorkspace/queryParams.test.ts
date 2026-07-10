import { describe, expect, it } from 'vitest';

import { buildUrlWithParams, parseQueryParams } from './queryParams';
import { createParamRow } from './types';

describe('parseQueryParams', () => {
  it('returns empty list for URL without query', () => {
    expect(parseQueryParams('https://example.com/path')).toEqual([]);
  });

  it('parses key/value pairs', () => {
    const rows = parseQueryParams('https://example.com?a=1&b=2');
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
    expect(rows.every((r) => r.enabled)).toBe(true);
  });

  it('parses repeated keys', () => {
    const rows = parseQueryParams('https://example.com?tag=a&tag=b');
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['tag', 'a'],
      ['tag', 'b'],
    ]);
  });

  it('decodes percent-encoded values', () => {
    const rows = parseQueryParams('https://example.com?q=hello%20world&x=a%26b');
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['q', 'hello world'],
      ['x', 'a&b'],
    ]);
  });

  it('handles keys without values', () => {
    const rows = parseQueryParams('https://example.com?flag');
    expect(rows.map((r) => [r.key, r.value])).toEqual([['flag', '']]);
  });

  it('ignores the fragment', () => {
    const rows = parseQueryParams('https://example.com?a=1#section');
    expect(rows.map((r) => [r.key, r.value])).toEqual([['a', '1']]);
  });

  it('tolerates partial URLs', () => {
    const rows = parseQueryParams('example?a=1');
    expect(rows.map((r) => [r.key, r.value])).toEqual([['a', '1']]);
  });

  it('survives malformed percent encoding', () => {
    const rows = parseQueryParams('https://example.com?a=%zz');
    expect(rows.map((r) => [r.key, r.value])).toEqual([['a', '%zz']]);
  });
});

describe('buildUrlWithParams', () => {
  it('appends params to a bare URL', () => {
    expect(
      buildUrlWithParams('https://example.com/path', [
        createParamRow('a', '1'),
        createParamRow('b', '2'),
      ]),
    ).toBe('https://example.com/path?a=1&b=2');
  });

  it('replaces the existing query string', () => {
    expect(buildUrlWithParams('https://example.com?old=x', [createParamRow('new', 'y')])).toBe(
      'https://example.com?new=y',
    );
  });

  it('drops the query when no rows remain', () => {
    expect(buildUrlWithParams('https://example.com?a=1', [])).toBe('https://example.com');
  });

  it('omits disabled rows', () => {
    const disabled = createParamRow('off', '1');
    disabled.enabled = false;
    expect(buildUrlWithParams('https://example.com', [disabled, createParamRow('on', '2')])).toBe(
      'https://example.com?on=2',
    );
  });

  it('omits rows with empty keys', () => {
    expect(
      buildUrlWithParams('https://example.com', [
        createParamRow('', 'x'),
        createParamRow('a', '1'),
      ]),
    ).toBe('https://example.com?a=1');
  });

  it('encodes keys and values', () => {
    expect(buildUrlWithParams('https://example.com', [createParamRow('q', 'a b&c')])).toBe(
      'https://example.com?q=a%20b%26c',
    );
  });

  it('preserves the fragment', () => {
    expect(buildUrlWithParams('https://example.com?a=1#top', [createParamRow('b', '2')])).toBe(
      'https://example.com?b=2#top',
    );
  });

  it('round-trips with parseQueryParams', () => {
    const url = 'https://example.com/api?q=hello%20world&page=2';
    const rows = parseQueryParams(url);
    expect(buildUrlWithParams(url, rows)).toBe(url);
  });
});
