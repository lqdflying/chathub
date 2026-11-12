import { CrawlImpl, CrawlSuccessResult } from '../type';
import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../utils/errorType';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

interface DeepSeekFetchResponse {
  content: string;
  title: string;
}

/**
 * DeepSeek Fetch API: returns one page as Markdown.
 *
 * @see https://api-docs.deepseek.com/guides/search
 */
export const deepseek: CrawlImpl = async (url) => {
  // DEEPSEEK_API_KEY may hold a comma-separated key pool; a bearer token takes one key
  const apiKey = process.env.DEEPSEEK_API_KEY?.split(',')
    .map((key) => key.trim())
    .find(Boolean);

  let res: Response;

  try {
    res = await withTimeout(
      fetch('https://api.deepseek.com/v1/tools/fetch', {
        body: JSON.stringify({ url }),
        headers: {
          'Authorization': !apiKey ? '' : `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
      DEFAULT_TIMEOUT,
    );
  } catch (e) {
    const error = e as Error;
    if (error.message === 'fetch failed') {
      throw new NetworkConnectionError();
    }

    if (error instanceof TimeoutError) {
      throw error;
    }

    throw e;
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new PageNotFoundError(res.statusText);
    }

    throw new Error(`DeepSeek request failed with status ${res.status}: ${res.statusText}`);
  }

  try {
    const data = (await res.json()) as DeepSeekFetchResponse;

    // Check if content is empty or too short
    if (!data.content || data.content.length < 100) {
      return;
    }

    return {
      content: data.content,
      contentType: 'text',
      length: data.content.length,
      siteName: new URL(url).hostname,
      title: data.title || new URL(url).hostname,
      url,
    } satisfies CrawlSuccessResult;
  } catch (error) {
    console.error(error);
  }

  return;
};
