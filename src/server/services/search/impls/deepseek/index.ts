import { SearchParams, UniformSearchResponse, UniformSearchResult } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import urlJoin from 'url-join';

import apiKeyManager from '@/server/modules/ModelRuntime/apiKeyManager';

import { SearchServiceImpl } from '../type';
import { DeepSeekResponse, DeepSeekSearchParameters } from './type';

const log = debug('lobe-search:DeepSeek');

// The API rejects a query longer than 128 Unicode characters.
const MAX_QUERY_LENGTH = 128;

const timeRangeDays = {
  day: 1,
  month: 30,
  week: 7,
  year: 365,
};

/**
 * The API has no time-range field; it reads an `after:YYYY-MM-DD` operator in the query.
 */
const buildQuery = (query: string, searchTimeRange?: string): string => {
  // `searchTimeRange` is an unvalidated string, so read own keys only
  const days =
    searchTimeRange && Object.hasOwn(timeRangeDays, searchTimeRange)
      ? timeRangeDays[searchTimeRange as keyof typeof timeRangeDays]
      : undefined;
  const operator = days
    ? ` after:${new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)}`
    : '';

  return [...query].slice(0, MAX_QUERY_LENGTH - operator.length).join('') + operator;
};

/**
 * DeepSeek Search API implementation of the search service
 *
 * @see https://api-docs.deepseek.com/guides/search
 */
export class DeepSeekImpl implements SearchServiceImpl {
  // DEEPSEEK_API_KEY may hold a comma-separated key pool, as it does for chat
  private get apiKey(): string {
    return apiKeyManager.pick(process.env.DEEPSEEK_API_KEY);
  }

  private get baseUrl(): string {
    return 'https://api.deepseek.com';
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting DeepSeek query with query: "%s", params: %o', query, params);
    const endpoint = urlJoin(this.baseUrl, '/v1/tools/search');

    const body: DeepSeekSearchParameters = {
      count: 15,
      query: buildQuery(query, params.searchTimeRange),
    };

    log('Constructed request body: %o', body);

    let response: Response;
    const startAt = Date.now();
    let costTime = 0;
    try {
      log('Sending request to endpoint: %s', endpoint);
      response = await fetch(endpoint, {
        body: JSON.stringify(body),
        headers: {
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      log('Received response with status: %d', response.status);
      costTime = Date.now() - startAt;
    } catch (error) {
      log.extend('error')('DeepSeek fetch error: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to DeepSeek.',
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.extend('error')(
        `DeepSeek request failed with status ${response.status}: %s`,
        errorBody.length > 200 ? `${errorBody.slice(0, 200)}...` : errorBody,
      );
      throw new TRPCError({
        cause: errorBody,
        code: 'SERVICE_UNAVAILABLE',
        message: `DeepSeek request failed: ${response.statusText}`,
      });
    }

    try {
      const deepseekResponse = (await response.json()) as DeepSeekResponse;

      log('Parsed DeepSeek response: %o', deepseekResponse);

      const mappedResults = (deepseekResponse.results || []).map((result): UniformSearchResult => ({
        category: 'general',
        // `summary` is the field the API writes for a model to read
        content: result.summary || result.snippet || '',
        engines: ['deepseek'],
        parsedUrl: result.url ? new URL(result.url).hostname : '',
        publishedDate: result.date ?? undefined,
        score: result.rerank_score ?? 1,
        title: result.title || '',
        url: result.url,
      }));

      log('Mapped %d results to SearchResult format', mappedResults.length);

      return {
        costTime,
        query: query,
        resultNumbers: mappedResults.length,
        results: mappedResults,
      };
    } catch (error) {
      log.extend('error')('Error parsing DeepSeek response: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse DeepSeek response.',
      });
    }
  }
}
