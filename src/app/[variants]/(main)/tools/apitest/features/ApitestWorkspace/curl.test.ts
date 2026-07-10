import { describe, expect, it } from 'vitest';

import { buildCurl, parseCurl, parsedCurlToDraft } from './curl';
import { createEmptyDraft, createHeaderRow } from './types';

describe('parseCurl', () => {
  it('parses a simple GET', () => {
    expect(parseCurl('curl https://example.com/api')).toEqual({
      basicPassword: undefined,
      basicUsername: undefined,
      bearerToken: undefined,
      body: undefined,
      contentType: undefined,
      headers: [],
      method: 'GET',
      url: 'https://example.com/api',
    });
  });

  it('parses explicit method and data', () => {
    const parsed = parseCurl(`curl -X POST https://example.com -d '{"a":1}'`);
    expect(parsed?.method).toBe('POST');
    expect(parsed?.body).toBe('{"a":1}');
  });

  it('infers POST from data flag', () => {
    const parsed = parseCurl(`curl https://example.com -d 'a=1'`);
    expect(parsed?.method).toBe('POST');
  });

  it('parses multiple headers and extracts content type', () => {
    const parsed = parseCurl(
      `curl https://example.com -H 'Content-Type: application/json' -H 'X-One: 1' -H 'X-Two: 2'`,
    );
    expect(parsed?.contentType).toBe('application/json');
    expect(parsed?.headers).toEqual([
      { key: 'X-One', value: '1' },
      { key: 'X-Two', value: '2' },
    ]);
  });

  it('extracts bearer token from Authorization header', () => {
    const parsed = parseCurl(`curl https://example.com -H 'Authorization: Bearer abc123'`);
    expect(parsed?.bearerToken).toBe('abc123');
    expect(parsed?.headers).toEqual([]);
  });

  it('handles double quotes and spaces', () => {
    const parsed = parseCurl(`curl "https://example.com/search" -H "X-Note: hello world"`);
    expect(parsed?.url).toBe('https://example.com/search');
    expect(parsed?.headers).toEqual([{ key: 'X-Note', value: 'hello world' }]);
  });

  it('handles backslash-newline continuations', () => {
    const parsed = parseCurl(`curl \\\n  -X PUT \\\n  https://example.com \\\n  -d 'x'`);
    expect(parsed?.method).toBe('PUT');
    expect(parsed?.url).toBe('https://example.com');
    expect(parsed?.body).toBe('x');
  });

  it('parses basic auth from -u', () => {
    const parsed = parseCurl(`curl -u alice:s3cret https://example.com`);
    expect(parsed?.basicUsername).toBe('alice');
    expect(parsed?.basicPassword).toBe('s3cret');
  });

  it('joins multiple data flags with &', () => {
    const parsed = parseCurl(`curl https://example.com -d a=1 -d b=2`);
    expect(parsed?.body).toBe('a=1&b=2');
  });

  it('encodes --data-urlencode values', () => {
    const parsed = parseCurl(`curl https://example.com --data-urlencode 'q=a b'`);
    expect(parsed?.body).toBe('q=a%20b');
  });

  it('ignores noise flags', () => {
    const parsed = parseCurl(`curl -sSL --compressed -o out.json https://example.com`);
    expect(parsed?.url).toBe('https://example.com');
  });

  it('supports --url and --request', () => {
    const parsed = parseCurl(`curl --request DELETE --url https://example.com/item/1`);
    expect(parsed?.method).toBe('DELETE');
    expect(parsed?.url).toBe('https://example.com/item/1');
  });

  it('maps -I to HEAD', () => {
    expect(parseCurl(`curl -I https://example.com`)?.method).toBe('HEAD');
  });

  it('returns null for non-curl input', () => {
    expect(parseCurl('wget https://example.com')).toBeNull();
    expect(parseCurl('')).toBeNull();
    expect(parseCurl('just some text')).toBeNull();
  });

  it('returns null when no URL is present', () => {
    expect(parseCurl('curl -X GET')).toBeNull();
  });
});

describe('parsedCurlToDraft', () => {
  it('maps basic auth into the draft', () => {
    const draft = parsedCurlToDraft(parseCurl(`curl -u alice:pw https://example.com`)!);
    expect(draft.authType).toBe('basic');
    expect(draft.basicUsername).toBe('alice');
    expect(draft.basicPassword).toBe('pw');
  });

  it('maps bearer token into the draft', () => {
    const draft = parsedCurlToDraft(
      parseCurl(`curl https://example.com -H 'Authorization: Bearer tok'`)!,
    );
    expect(draft.authType).toBe('bearer');
    expect(draft.bearerToken).toBe('tok');
  });

  it('keeps one empty header row when none parsed', () => {
    const draft = parsedCurlToDraft(parseCurl('curl https://example.com')!);
    expect(draft.headers).toHaveLength(1);
    expect(draft.headers[0].key).toBe('');
  });
});

describe('buildCurl', () => {
  it('renders method, url, headers and body', () => {
    const draft = createEmptyDraft();
    draft.method = 'POST';
    draft.url = 'https://example.com/api';
    draft.body = '{"a":1}';
    draft.headers = [createHeaderRow('X-Test', 'yes')];

    const curl = buildCurl(draft);
    expect(curl).toContain(`curl -X POST 'https://example.com/api'`);
    expect(curl).toContain(`-H 'X-Test: yes'`);
    expect(curl).toContain(`-H 'Content-Type: application/json'`);
    expect(curl).toContain(`--data '{"a":1}'`);
  });

  it('escapes single quotes in values', () => {
    const draft = createEmptyDraft();
    draft.method = 'POST';
    draft.url = 'https://example.com';
    draft.body = `{"name":"O'Brien"}`;

    expect(buildCurl(draft)).toContain(String.raw`--data '{"name":"O'\''Brien"}'`);
  });

  it('round-trips through parseCurl', () => {
    const draft = createEmptyDraft();
    draft.method = 'PUT';
    draft.url = 'https://example.com/items/9';
    draft.body = '{"done":true}';
    draft.authType = 'bearer';
    draft.bearerToken = 'tok123';

    const reparsed = parseCurl(buildCurl(draft).replaceAll('\\\n', '\n'));
    expect(reparsed?.method).toBe('PUT');
    expect(reparsed?.url).toBe('https://example.com/items/9');
    expect(reparsed?.body).toBe('{"done":true}');
    expect(reparsed?.bearerToken).toBe('tok123');
  });
});
