// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeepSeekImpl } from './index';

const mockFetch = (response: Partial<Response>) => {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const sentBody = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse(fetchMock.mock.calls[0][1].body);

describe('DeepSeekImpl', () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('posts the query to the Search API and maps the results', async () => {
    const fetchMock = mockFetch({
      json: async () => ({
        results: [
          {
            authority: 3,
            content: '',
            date: '2026-06-01T00:00:00+00:00',
            rerank_score: 2.4,
            site_icon: null,
            site_name: 'Example News',
            snippet: 'short snippet',
            summary: 'long summary',
            title: 'DeepSeek V4 model released',
            url: 'https://example.com/deepseek-v4',
          },
        ],
      }),
      ok: true,
    });

    const result = await new DeepSeekImpl().query('DeepSeek V4 release');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/tools/search');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(sentBody(fetchMock)).toEqual({ count: 15, query: 'DeepSeek V4 release' });

    expect(result.resultNumbers).toBe(1);
    expect(result.results[0]).toEqual({
      category: 'general',
      content: 'long summary',
      engines: ['deepseek'],
      parsedUrl: 'example.com',
      publishedDate: '2026-06-01T00:00:00+00:00',
      score: 2.4,
      title: 'DeepSeek V4 model released',
      url: 'https://example.com/deepseek-v4',
    });
  });

  it('turns a time range into an after: operator', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    const fetchMock = mockFetch({ json: async () => ({ results: [] }), ok: true });

    await new DeepSeekImpl().query('DeepSeek', { searchTimeRange: 'week' });

    expect(sentBody(fetchMock).query).toBe('DeepSeek after:2026-11-05');
  });

  it('keeps the query within 128 characters', async () => {
    const fetchMock = mockFetch({ json: async () => ({ results: [] }), ok: true });

    await new DeepSeekImpl().query('a'.repeat(200), { searchTimeRange: 'day' });

    const { query } = sentBody(fetchMock);
    expect([...query]).toHaveLength(128);
    expect(query).toMatch(/ after:\d{4}-\d{2}-\d{2}$/);
  });

  it('throws SERVICE_UNAVAILABLE on a non-200 response', async () => {
    mockFetch({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => '{}' });

    await expect(new DeepSeekImpl().query('DeepSeek')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});
