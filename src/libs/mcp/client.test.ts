import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { sanitizeToolDebugPayload } from './client';

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
      expect(getProperty(out, key)).toMatchObject({ secret: true, value: '[redacted]' });
    }
    const nested = getProperty(out, 'nested').value;
    expect(getProperty(nested, 'refreshToken')).toMatchObject({
      secret: true,
      value: '[redacted]',
    });
    expect(getProperty(nested, 'value').value).toBe(1);
    expect(getProperty(out, 'name').value).toMatchObject({ length: 6, type: 'string' });
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
    const out = sanitizeToolDebugPayload({ list: [1, 2, 3, 4, 5] }) as any;
    expect(getProperty(out, 'list').value).toEqual([1, 2, 3, '(+2 more)']);
  });

  it('leaves short arrays untouched', () => {
    const out = sanitizeToolDebugPayload({ list: [1, 2] }) as any;
    expect(getProperty(out, 'list').value).toEqual([1, 2]);
  });

  it('bounds recursion depth', () => {
    const deep: any = { a: { b: { c: { d: { e: { f: 'too deep' } } } } } };
    const out = sanitizeToolDebugPayload(deep) as any;
    // depth 0→4 allowed; beyond that replaced with the marker
    const a = getProperty(out, 'a').value;
    const b = getProperty(a, 'b').value;
    const c = getProperty(b, 'c').value;
    expect(getProperty(c, 'd').value).toBe('[truncated:max-depth]');
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

    expect(getProperty(out, 'isError').value).toBe(false);
    expect(getProperty(out, 'token')).toMatchObject({ secret: true, value: '[redacted]' });
    const content = getProperty(out, 'content').value;
    expect(content).toHaveLength(4); // 3 items + remainder marker
    expect(content[3]).toBe('(+1 more)');
    expect(getProperty(content[0], 'text').value).toMatchObject({ length: 5, type: 'string' });
    expect(getProperty(content[0], 'type').value).toMatchObject({ length: 4, type: 'string' });
    expect(JSON.stringify(out)).not.toMatch(/hello|world|extra/);
  });

  it('fingerprints user-controlled property names and bounds object width', () => {
    const input = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [`person-${index}@example.com`, index]),
    );
    const out = sanitizeToolDebugPayload(input) as any;

    expect(out).toMatchObject({ omittedProperties: 5, propertyCount: 25, type: 'object' });
    expect(out.entries).toHaveLength(20);
    expect(JSON.stringify(out)).not.toContain('person-');
  });
});
