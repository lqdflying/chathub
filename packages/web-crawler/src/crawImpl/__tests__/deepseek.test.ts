import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageNotFoundError } from '../../utils/errorType';
import { deepseek } from '../deepseek';

const content = 'This is a test page content with sufficient length to pass validation. '.repeat(3);

const mockFetch = (response: Partial<Response>) => {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('deepseek crawler', () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('posts the url to the Fetch API and returns the page', async () => {
    const fetchMock = mockFetch({
      json: async () => ({ content, title: 'Example article' }),
      ok: true,
    });

    const result = await deepseek('https://example.com/article', { filterOptions: {} });

    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe('https://api.deepseek.com/v1/tools/fetch');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-api-key');
    expect(JSON.parse(init.body)).toEqual({ url: 'https://example.com/article' });

    expect(result).toEqual({
      content,
      contentType: 'text',
      length: content.length,
      siteName: 'example.com',
      title: 'Example article',
      url: 'https://example.com/article',
    });
  });

  it('returns undefined for short content', async () => {
    mockFetch({ json: async () => ({ content: 'short', title: '' }), ok: true });

    expect(await deepseek('https://example.com', { filterOptions: {} })).toBeUndefined();
  });

  it('throws PageNotFoundError on 404', async () => {
    mockFetch({ ok: false, status: 404, statusText: 'Not Found' });

    await expect(deepseek('https://example.com', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('throws on other failed statuses', async () => {
    mockFetch({ ok: false, status: 429, statusText: 'Too Many Requests' });

    await expect(deepseek('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'DeepSeek request failed with status 429: Too Many Requests',
    );
  });
});
