import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { sanitizeToolDebugPayload } from '@/libs/logger/toolsDebug';

const getProperty = (value: any, key: string) =>
  value.entries.find(
    (entry: any) =>
      entry.key.hash === createHash('sha256').update(key).digest('hex').slice(0, 16),
  );

describe('sanitizeToolDebugPayload', () => {
  it('passes through null, undefined, and primitives', () => {
    expect(sanitizeToolDebugPayload(null)).toBeNull();
    expect(sanitizeToolDebugPayload(undefined)).toBeUndefined();
    expect(sanitizeToolDebugPayload(42)).toBe(42);
    expect(sanitizeToolDebugPayload(true)).toBe(true);
  });

  it('normalizes JSON-unsafe primitives without exposing their values', () => {
    expect(sanitizeToolDebugPayload(42n)).toEqual({ type: 'bigint' });
    expect(sanitizeToolDebugPayload(Symbol('private-symbol'))).toEqual({ type: 'symbol' });
    expect(sanitizeToolDebugPayload(() => 'private-result')).toEqual({ type: 'function' });
  });

  it('omits secret-keyed fields, case-insensitively', () => {
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
      userId: 123_456_789,
    };

    const out = sanitizeToolDebugPayload(input) as any;

    for (const key of [
      'accessToken',
      'ACCESS_TOKEN',
      'api_key',
      'ApiKey',
      'password',
      'Authorization',
      'authorizationHeader',
      'COOKIE',
    ]) {
      expect(getProperty(out, key)).toBeUndefined();
    }
    const nested = getProperty(out, 'nested').value;
    expect(getProperty(nested, 'refreshToken')).toBeUndefined();
    expect(getProperty(nested, 'value').value).toBe(1);
    expect(getProperty(out, 'name').value).toMatchObject({ length: 6, type: 'string' });
    expect(getProperty(out, 'userId').value).toMatchObject({ type: 'identifier' });
    expect(JSON.stringify(out)).not.toMatch(/abc|def|ghi|jkl|mno|session|secret-token|Bearer/);
    expect(JSON.stringify(out)).not.toContain('123456789');
  });

  it('fingerprints long strings without retaining any raw prefix', () => {
    const long = 'a'.repeat(600);
    const out = sanitizeToolDebugPayload({ text: long }) as any;

    const text = getProperty(out, 'text').value;
    expect(text).toMatchObject({ length: 600, type: 'string' });
    expect(text.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(out)).not.toContain('a'.repeat(20));
  });

  it('fingerprints short strings too', () => {
    const out = sanitizeToolDebugPayload({ text: 'short' }) as any;
    expect(getProperty(out, 'text').value).toMatchObject({ length: 5, type: 'string' });
    expect(JSON.stringify(out)).not.toContain('short');
  });

  it('caps arrays and reports the remainder', () => {
    const out = sanitizeToolDebugPayload({ list: Array.from({ length: 12 }, (_, index) => index) }) as any;
    expect(getProperty(out, 'list').value).toEqual({
      itemCount: 12,
      items: Array.from({ length: 10 }, (_, index) => index),
      omittedItems: 2,
      type: 'array',
    });
  });

  it('describes short arrays without dropping items', () => {
    const out = sanitizeToolDebugPayload({ list: [1, 2] }) as any;
    expect(getProperty(out, 'list').value).toEqual({
      itemCount: 2,
      items: [1, 2],
      omittedItems: 0,
      type: 'array',
    });
  });

  it('bounds recursion depth', () => {
    const deep: any = { a: { b: { c: { d: { e: { f: { g: 'too deep' } } } } } } };
    const out = sanitizeToolDebugPayload(deep) as any;
    // depth 0→5 allowed; beyond that is replaced with the marker.
    const a = getProperty(out, 'a').value;
    const b = getProperty(a, 'b').value;
    const c = getProperty(b, 'c').value;
    const d = getProperty(c, 'd').value;
    const e = getProperty(d, 'e').value;
    expect(getProperty(e, 'f').value).toBe('[truncated:max-depth]');
  });

  it('does not mutate the input object', () => {
    const input = { accessToken: 'secret', list: [1, 2, 3, 4], text: 'x'.repeat(600) };
    const snapshot = JSON.parse(JSON.stringify(input));

    sanitizeToolDebugPayload(input);

    expect(input).toEqual(snapshot);
  });

  it('replaces property values that cannot be read', () => {
    const input = {};
    Object.defineProperty(input, 'danger', {
      enumerable: true,
      get: () => {
        throw new Error('private getter failure');
      },
    });

    const out = sanitizeToolDebugPayload(input) as any;

    expect(getProperty(out, 'danger').value).toEqual({ type: 'unavailable' });
    expect(JSON.stringify(out)).not.toContain('private getter failure');
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

    expect(getProperty(out, 'isError').value).toBe(false);
    expect(getProperty(out, 'token')).toBeUndefined();
    const content = getProperty(out, 'content').value;
    expect(content).toMatchObject({ itemCount: 4, omittedItems: 0, type: 'array' });
    expect(content.items).toHaveLength(4);
    expect(getProperty(content.items[0], 'text').value).toMatchObject({ length: 5, type: 'string' });
    expect(getProperty(content.items[0], 'type').value).toMatchObject({ length: 4, type: 'string' });
    expect(JSON.stringify(out)).not.toMatch(/hello|world|extra/);
  });

  it('fingerprints user-controlled property names and bounds object width', () => {
    const input = Object.fromEntries(
      Array.from({ length: 55 }, (_, index) => [`person-${index}@example.com`, index]),
    );
    const out = sanitizeToolDebugPayload(input) as any;

    expect(out).toMatchObject({ omittedProperties: 5, propertyCount: 55, type: 'object' });
    expect(out.entries).toHaveLength(50);
    expect(JSON.stringify(out)).not.toContain('person-');
  });
});
