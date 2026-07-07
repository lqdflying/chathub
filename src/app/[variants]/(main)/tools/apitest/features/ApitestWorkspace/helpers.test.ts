import { describe, expect, it } from 'vitest';

import {
  buildAuthHeader,
  buildProxyRequestPayload,
  buildRequestHeaders,
  formatJson,
  isValidUrl,
} from './helpers';

describe('isValidUrl', () => {
  it('accepts http URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  it('accepts https URLs', () => {
    expect(isValidUrl('https://api.example.com/v1/users')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidUrl('')).toBe(false);
  });

  it('rejects URL without protocol', () => {
    expect(isValidUrl('example.com')).toBe(false);
  });

  it('rejects ftp URLs', () => {
    expect(isValidUrl('ftp://example.com')).toBe(false);
  });
});

describe('buildAuthHeader', () => {
  it('returns undefined for none', () => {
    expect(buildAuthHeader('none', '', '', '')).toBeUndefined();
  });

  it('returns Bearer header', () => {
    expect(buildAuthHeader('bearer', 'mytoken123', '', '')).toBe('Bearer mytoken123');
  });

  it('trims bearer token whitespace', () => {
    expect(buildAuthHeader('bearer', '  mytoken123  ', '', '')).toBe('Bearer mytoken123');
  });

  it('returns undefined for bearer with empty token', () => {
    expect(buildAuthHeader('bearer', '', '', '')).toBeUndefined();
  });

  it('returns Basic header (base64 encoded)', () => {
    const header = buildAuthHeader('basic', '', 'user', 'pass');
    expect(header).toBe(`Basic ${btoa('user:pass')}`);
  });

  it('returns undefined for basic with empty username and password', () => {
    expect(buildAuthHeader('basic', '', '', '')).toBeUndefined();
  });
});

describe('buildRequestHeaders', () => {
  it('builds bearer auth headers', () => {
    expect(buildRequestHeaders([], 'bearer', 'token123', '', '')).toEqual({
      Authorization: 'Bearer token123',
    });
  });

  it('keeps auth tab Authorization above duplicate custom header', () => {
    expect(
      buildRequestHeaders(
        [{ enabled: true, key: 'Authorization', value: 'Bearer custom-token' }],
        'bearer',
        'auth-tab-token',
        '',
        '',
      ),
    ).toEqual({ Authorization: 'Bearer auth-tab-token' });
  });

  it('includes content type only when provided', () => {
    expect(buildRequestHeaders([], 'none', '', '', '', 'application/json')).toEqual({
      'Content-Type': 'application/json',
    });
  });
});

describe('buildProxyRequestPayload', () => {
  it('builds GET bearer request without body', () => {
    expect(
      buildProxyRequestPayload({
        authType: 'bearer',
        basicPassword: '',
        basicUsername: '',
        bearerToken: 'token123',
        body: '{"unused":true}',
        contentType: 'application/json',
        headers: [],
        method: 'GET',
        url: ' https://api.example.com/users ',
      }),
    ).toEqual({
      body: undefined,
      headers: { Authorization: 'Bearer token123' },
      method: 'GET',
      url: 'https://api.example.com/users',
    });
  });

  it('adds body and content type for POST requests', () => {
    expect(
      buildProxyRequestPayload({
        authType: 'none',
        basicPassword: '',
        basicUsername: '',
        bearerToken: '',
        body: '{"name":"test"}',
        contentType: 'application/json',
        headers: [{ enabled: true, key: 'X-Test', value: 'yes' }],
        method: 'POST',
        url: 'https://api.example.com/users',
      }),
    ).toEqual({
      body: '{"name":"test"}',
      headers: { 'Content-Type': 'application/json', 'X-Test': 'yes' },
      method: 'POST',
      url: 'https://api.example.com/users',
    });
  });
});

describe('formatJson', () => {
  it('formats valid JSON', () => {
    const result = formatJson('{"a":1,"b":2}');
    expect(result).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('throws on invalid JSON', () => {
    expect(() => formatJson('not json')).toThrow();
  });

  it('handles nested objects', () => {
    const result = formatJson('{"a":{"b":1}}');
    expect(result).toBe('{\n  "a": {\n    "b": 1\n  }\n}');
  });
});
