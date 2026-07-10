import { describe, expect, it } from 'vitest';

import {
  buildAuthHeader,
  buildProxyRequestPayload,
  buildRequestHeaders,
  detectHighlightLanguage,
  formatJson,
  getResponseSize,
  isValidUrl,
} from './helpers';
import { type ApiTesterRequestDraft, createEmptyDraft, createHeaderRow } from './types';

const draftWith = (overrides: Partial<ApiTesterRequestDraft>): ApiTesterRequestDraft => ({
  ...createEmptyDraft(),
  headers: [],
  ...overrides,
});

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

  it('encodes unicode basic auth credentials as UTF-8', () => {
    const encoded = buildAuthHeader('basic', '', '用户', '密码')?.replace('Basic ', '');
    expect(new TextDecoder().decode(Uint8Array.from(atob(encoded!), (char) => char.charCodeAt(0)))).toBe(
      '用户:密码',
    );
  });

  it('returns undefined for basic with empty username and password', () => {
    expect(buildAuthHeader('basic', '', '', '')).toBeUndefined();
  });
});

describe('buildRequestHeaders', () => {
  it('builds bearer auth headers', () => {
    expect(buildRequestHeaders(draftWith({ authType: 'bearer', bearerToken: 'token123' }))).toEqual(
      {
        Authorization: 'Bearer token123',
      },
    );
  });

  it('keeps auth tab Authorization above duplicate custom header', () => {
    expect(
      buildRequestHeaders(
        draftWith({
          authType: 'bearer',
          bearerToken: 'auth-tab-token',
          headers: [createHeaderRow('Authorization', 'Bearer custom-token')],
        }),
      ),
    ).toEqual({ Authorization: 'Bearer auth-tab-token' });
  });

  it('skips disabled header rows', () => {
    const disabled = createHeaderRow('X-Disabled', 'nope');
    disabled.enabled = false;
    expect(
      buildRequestHeaders(draftWith({ headers: [disabled, createHeaderRow('X-On', 'yes')] })),
    ).toEqual({ 'X-On': 'yes' });
  });

  it('includes content type only when provided', () => {
    expect(buildRequestHeaders(draftWith({}), 'application/json')).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('preserves explicit content-type header rows over body tab content type', () => {
    expect(
      buildRequestHeaders(
        draftWith({
          headers: [createHeaderRow('Content-Type', 'multipart/form-data; boundary=abc')],
        }),
        'application/json',
      ),
    ).toEqual({ 'Content-Type': 'multipart/form-data; boundary=abc' });
  });

  it('adds api key as custom header', () => {
    expect(
      buildRequestHeaders(
        draftWith({
          apiKeyLocation: 'header',
          apiKeyName: 'X-Api-Key',
          apiKeyValue: 'secret',
          authType: 'apikey',
        }),
      ),
    ).toEqual({ 'X-Api-Key': 'secret' });
  });

  it('does not add api key header when location is query', () => {
    expect(
      buildRequestHeaders(
        draftWith({
          apiKeyLocation: 'query',
          apiKeyName: 'api_key',
          apiKeyValue: 'secret',
          authType: 'apikey',
        }),
      ),
    ).toEqual({});
  });
});

describe('buildProxyRequestPayload', () => {
  it('builds GET bearer request without body', () => {
    expect(
      buildProxyRequestPayload(
        draftWith({
          authType: 'bearer',
          bearerToken: 'token123',
          body: '{"unused":true}',
          method: 'GET',
          url: ' https://api.example.com/users ',
        }),
      ),
    ).toEqual({
      body: undefined,
      headers: { Authorization: 'Bearer token123' },
      method: 'GET',
      url: 'https://api.example.com/users',
    });
  });

  it('adds body and content type for POST requests', () => {
    expect(
      buildProxyRequestPayload(
        draftWith({
          body: '{"name":"test"}',
          headers: [createHeaderRow('X-Test', 'yes')],
          method: 'POST',
          url: 'https://api.example.com/users',
        }),
      ),
    ).toEqual({
      body: '{"name":"test"}',
      headers: { 'Content-Type': 'application/json', 'X-Test': 'yes' },
      method: 'POST',
      url: 'https://api.example.com/users',
    });
  });

  it('keeps body for DELETE and OPTIONS requests', () => {
    for (const method of ['DELETE', 'OPTIONS']) {
      expect(
        buildProxyRequestPayload(
          draftWith({
            body: '{"reason":"duplicate"}',
            method,
            url: 'https://api.example.com/users/1',
          }),
        ),
      ).toMatchObject({
        body: '{"reason":"duplicate"}',
        method,
      });
    }
  });

  it('appends api key to the query string', () => {
    expect(
      buildProxyRequestPayload(
        draftWith({
          apiKeyLocation: 'query',
          apiKeyName: 'api_key',
          apiKeyValue: 'secret',
          authType: 'apikey',
          method: 'GET',
          url: 'https://api.example.com/users?page=1',
        }),
      ),
    ).toEqual({
      body: undefined,
      headers: {},
      method: 'GET',
      url: 'https://api.example.com/users?page=1&api_key=secret',
    });
  });

  it('appends api key before URL fragments in fallback mode', () => {
    expect(
      buildProxyRequestPayload(
        draftWith({
          apiKeyLocation: 'query',
          apiKeyName: 'api_key',
          apiKeyValue: 'secret',
          authType: 'apikey',
          method: 'GET',
          url: 'https://api.example.com/users/%zz#section',
        }),
      ).url,
    ).toBe('https://api.example.com/users/%zz?api_key=secret#section');
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

describe('getResponseSize', () => {
  it('counts ascii bytes', () => {
    expect(getResponseSize('hello')).toBe(5);
  });

  it('counts multibyte characters as UTF-8 bytes', () => {
    expect(getResponseSize('日本')).toBe(6);
  });

  it('returns 0 for empty body', () => {
    expect(getResponseSize('')).toBe(0);
  });
});

describe('detectHighlightLanguage', () => {
  it('detects json from content type', () => {
    expect(detectHighlightLanguage('application/json; charset=utf-8', '')).toBe('json');
  });

  it('detects html from content type', () => {
    expect(detectHighlightLanguage('text/html', '<html></html>')).toBe('html');
  });

  it('detects xml from content type', () => {
    expect(detectHighlightLanguage('application/xml', '<a/>')).toBe('xml');
  });

  it('sniffs json body without content type', () => {
    expect(detectHighlightLanguage('', '{"a":1}')).toBe('json');
  });

  it('falls back to text', () => {
    expect(detectHighlightLanguage('text/plain', 'hello')).toBe('text');
  });
});
