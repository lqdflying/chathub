import { beforeEach, describe, expect, it } from 'vitest';

import {
  type ApiTesterHistoryEntry,
  HISTORY_LIMIT,
  HISTORY_STORAGE_KEY,
  appendHistoryEntry,
  loadHistory,
  sanitizeHistoryEntry,
  saveHistory,
} from './history';
import { createEmptyDraft, createHeaderRow } from './types';

const makeEntry = (id: string): ApiTesterHistoryEntry => ({
  createdAt: 1_700_000_000_000,
  id,
  request: { ...createEmptyDraft(), method: 'GET', url: `https://example.com/${id}` },
  response: { size: 10, status: 200, time: 42 },
});

describe('appendHistoryEntry', () => {
  it('prepends the new entry', () => {
    const list = appendHistoryEntry([makeEntry('a')], makeEntry('b'));
    expect(list.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('caps the list at the limit', () => {
    let list: ApiTesterHistoryEntry[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      list = appendHistoryEntry(list, makeEntry(`e${i}`));
    }
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0].id).toBe(`e${HISTORY_LIMIT + 4}`);
  });

  it('redacts secrets before adding entries', () => {
    const entry = makeEntry('secret');
    entry.request = {
      ...entry.request,
      apiKeyName: 'api_key',
      apiKeyValue: 'query-secret',
      authType: 'apikey',
      bearerToken: 'bearer-secret',
      basicPassword: 'basic-secret',
      headers: [
        createHeaderRow('Authorization', 'Bearer secret'),
        createHeaderRow('Cookie', 'sid=secret'),
        createHeaderRow('X-Request-Id', 'req-1'),
      ],
      url: 'https://example.com/users?api_key=query-secret&page=1',
    };

    const [redacted] = appendHistoryEntry([], entry);

    expect(redacted.request.apiKeyValue).toBe('');
    expect(redacted.request.bearerToken).toBe('');
    expect(redacted.request.basicPassword).toBe('');
    expect(redacted.request.headers.map((header) => [header.key, header.value])).toEqual([
      ['Authorization', ''],
      ['Cookie', ''],
      ['X-Request-Id', 'req-1'],
    ]);
    expect(redacted.request.url).toBe('https://example.com/users?api_key=&page=1');
  });
});

describe('sanitizeHistoryEntry', () => {
  it('redacts sensitive header name fragments', () => {
    const entry = makeEntry('headers');
    entry.request.headers = [
      createHeaderRow('X-Custom-Token', 'tok'),
      createHeaderRow('client_secret', 'secret'),
      createHeaderRow('Accept', 'application/json'),
    ];

    expect(sanitizeHistoryEntry(entry).request.headers.map((header) => header.value)).toEqual([
      '',
      '',
      'application/json',
    ]);
  });

  it('redacts query api keys from partial URLs', () => {
    const entry = makeEntry('query');
    entry.request = {
      ...entry.request,
      apiKeyLocation: 'query',
      apiKeyName: 'api_key',
      apiKeyValue: 'secret',
      authType: 'apikey',
      url: 'example.test/search?api_key=secret&q=test#top',
    };

    expect(sanitizeHistoryEntry(entry).request.url).toBe('example.test/search?api_key=&q=test#top');
  });

  it('redacts repeated query api key values without collapsing the URL', () => {
    const entry = makeEntry('repeated-query');
    entry.request = {
      ...entry.request,
      apiKeyName: 'api_key',
      apiKeyValue: 'secret',
      authType: 'apikey',
      url: 'https://example.com/search?api_key=one&api_key=two&q=test',
    };

    expect(sanitizeHistoryEntry(entry).request.url).toBe(
      'https://example.com/search?api_key=&api_key=&q=test',
    );
  });
});

describe('loadHistory / saveHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns [] when nothing is stored', () => {
    expect(loadHistory()).toEqual([]);
  });

  it('round-trips entries', () => {
    const entries = [makeEntry('a'), makeEntry('b')];
    saveHistory(entries);
    const loaded = loadHistory();
    expect(loaded.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(loaded.map((entry) => entry.request.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
    expect(loaded.map((entry) => entry.request.headers[0])).toEqual([
      expect.objectContaining({ enabled: true, key: '', value: '' }),
      expect.objectContaining({ enabled: true, key: '', value: '' }),
    ]);
  });

  it('persists only redacted entries', () => {
    const entry = makeEntry('stored');
    entry.request.authType = 'bearer';
    entry.request.bearerToken = 'secret-token';
    entry.request.headers = [createHeaderRow('Authorization', 'Bearer secret')];

    saveHistory([entry]);

    const stored = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
    expect(stored[0].request.bearerToken).toBe('');
    expect(stored[0].request.headers[0].value).toBe('');
    expect(loadHistory()[0].request.bearerToken).toBe('');
  });

  it('returns [] on corrupt JSON', () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, '{not json');
    expect(loadHistory()).toEqual([]);
  });

  it('returns [] when the stored value is not an array', () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(loadHistory()).toEqual([]);
  });

  it('filters out malformed entries', () => {
    const good = makeEntry('good');
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify([good, { id: 'bad' }, null, 'string']),
    );
    const loaded = loadHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      createdAt: good.createdAt,
      id: good.id,
      request: expect.objectContaining({
        method: good.request.method,
        url: good.request.url,
      }),
      response: good.response,
    });
  });

  it('redacts legacy stored entries when loading', () => {
    const entry = makeEntry('legacy');
    entry.request.authType = 'basic';
    entry.request.basicPassword = 'stored-password';
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([entry]));

    expect(loadHistory()[0].request.basicPassword).toBe('');
  });

  it('normalizes legacy requests with missing draft fields', () => {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          createdAt: 1,
          id: 'legacy',
          request: {
            headers: [{ key: 'Accept', value: 'application/json' }],
            method: 'get',
            url: 'https://example.com',
          },
        },
      ]),
    );

    const [entry] = loadHistory();

    expect(entry.request).toMatchObject({
      apiKeyLocation: 'header',
      apiKeyName: 'X-Api-Key',
      authType: 'none',
      body: '',
      contentType: 'application/json',
      method: 'GET',
      url: 'https://example.com',
    });
    expect(entry.request.headers).toHaveLength(1);
    expect(entry.request.headers[0]).toMatchObject({
      enabled: true,
      key: 'Accept',
      value: 'application/json',
    });
    expect(entry.request.headers[0].id).toBeTruthy();
  });

  it('repairs malformed header rows instead of restoring them', () => {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          createdAt: 1,
          id: 'partial',
          request: {
            headers: [null, { key: 'X-Trace', value: 'trace-1' }, { enabled: true, key: 'Bad' }],
            method: 'GET',
            url: 'https://example.com',
          },
        },
      ]),
    );

    expect(loadHistory()[0].request.headers.map((header) => header.key)).toEqual(['X-Trace']);
  });

  it('drops entries with unsupported methods', () => {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          createdAt: 1,
          id: 'trace',
          request: {
            headers: [],
            method: 'TRACE',
            url: 'https://example.com',
          },
        },
      ]),
    );

    expect(loadHistory()).toEqual([]);
  });
});
