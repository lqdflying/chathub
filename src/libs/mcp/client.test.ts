import { describe, expect, it } from 'vitest';

import { sanitizeToolDebugPayload } from './client';

describe('sanitizeToolDebugPayload', () => {
  it('passes through null, undefined, and primitives', () => {
    expect(sanitizeToolDebugPayload(null)).toBeNull();
    expect(sanitizeToolDebugPayload(undefined)).toBeUndefined();
    expect(sanitizeToolDebugPayload(42)).toBe(42);
    expect(sanitizeToolDebugPayload(true)).toBe(true);
  });

  it('redacts secret values by key, case-insensitively', () => {
    const input = {
      ACCESS_TOKEN: 'abc',
      ApiKey: 'ghi',
      Authorization: 'Bearer xyz',
      COOKIE: 'session',
      accessToken: 'secret-token',
      api_key: 'jkl',
      authorizationHeader: 'Bearer y',
      name: 'public',
      nested: { refreshToken: 'mno', value: 1 },
      password: 'def',
    };

    const out = sanitizeToolDebugPayload(input) as Record<string, any>;

    expect(out.accessToken).toBe('[redacted]');
    expect(out.ACCESS_TOKEN).toBe('[redacted]');
    expect(out.api_key).toBe('[redacted]');
    expect(out.ApiKey).toBe('[redacted]');
    expect(out.password).toBe('[redacted]');
    expect(out.Authorization).toBe('[redacted]');
    expect(out.authorizationHeader).toBe('[redacted]');
    expect(out.COOKIE).toBe('[redacted]');
    expect(out.nested.refreshToken).toBe('[redacted]');
    expect(out.nested.value).toBe(1);
    expect(out.name).toBe('public');
  });

  it('truncates strings longer than the max length', () => {
    const long = 'a'.repeat(600);
    const out = sanitizeToolDebugPayload({ text: long }) as { text: string };

    expect(out.text.startsWith('a'.repeat(500))).toBe(true);
    expect(out.text.endsWith('…(+100)')).toBe(true);
    expect(out.text.length).toBe(500 + '…(+100)'.length);
  });

  it('leaves short strings untouched', () => {
    const out = sanitizeToolDebugPayload({ text: 'short' }) as { text: string };
    expect(out.text).toBe('short');
  });

  it('caps arrays and reports the remainder', () => {
    const out = sanitizeToolDebugPayload({ list: [1, 2, 3, 4, 5] }) as { list: unknown[] };
    expect(out.list).toEqual([1, 2, 3, '(+2 more)']);
  });

  it('leaves short arrays untouched', () => {
    const out = sanitizeToolDebugPayload({ list: [1, 2] }) as { list: unknown[] };
    expect(out.list).toEqual([1, 2]);
  });

  it('bounds recursion depth', () => {
    const deep: any = { a: { b: { c: { d: { e: { f: 'too deep' } } } } } };
    const out = sanitizeToolDebugPayload(deep) as any;
    // depth 0→4 allowed; beyond that replaced with the marker
    expect(out.a.b.c.d).toBe('[truncated:max-depth]');
  });

  it('does not mutate the input object', () => {
    const input = { accessToken: 'secret', list: [1, 2, 3, 4], text: 'x'.repeat(600) };
    const snapshot = JSON.parse(JSON.stringify(input));

    sanitizeToolDebugPayload(input);

    expect(input).toEqual(snapshot);
  });

  it('sanitizes a realistic MCP tool result shape', () => {
    const result = {
      content: [
        { text: 'hello', type: 'text' },
        { text: 'world', type: 'text' },
        { text: 'extra1', type: 'text' },
        { text: 'extra2', type: 'text' },
      ],
      isError: false,
      token: 'should-hide',
    };

    const out = sanitizeToolDebugPayload(result) as any;

    expect(out.isError).toBe(false);
    expect(out.token).toBe('[redacted]');
    expect(out.content).toHaveLength(4); // 3 items + remainder marker
    expect(out.content[3]).toBe('(+1 more)');
    expect(out.content[0]).toEqual({ text: 'hello', type: 'text' });
  });
});
