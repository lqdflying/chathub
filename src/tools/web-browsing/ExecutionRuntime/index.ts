import { crawlResultsPrompt, searchResultsPrompt } from '@lobechat/prompts';
import {
  BuiltinServerRuntimeOutput,
  CrawlMultiPagesQuery,
  CrawlSinglePageQuery,
  SearchContent,
  SearchQuery,
  SearchServiceImpl,
} from '@lobechat/types';

import { CRAWL_CONTENT_LIMITED_COUNT, SEARCH_ITEM_LIMITED_COUNT } from '../const';

export class WebBrowsingExecutionRuntime {
  private searchService: SearchServiceImpl;

  constructor(options: { searchService: SearchServiceImpl }) {
    this.searchService = options.searchService;
  }

  async search(
    args: SearchQuery,
    options?: { diagnosticId?: string },
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = options
        ? await this.searchService.webSearch(args as SearchQuery, options)
        : await this.searchService.webSearch(args as SearchQuery);

      // add LIMITED_COUNT search results to message content
      const searchContent: SearchContent[] = data.results
        .slice(0, SEARCH_ITEM_LIMITED_COUNT)
        .map((item) => ({
          title: item.title,
          url: item.url,
          ...(item.content && { content: item.content }),
          ...(item.publishedDate && { publishedDate: item.publishedDate }),
          ...(item.imgSrc && { imgSrc: item.imgSrc }),
          ...(item.thumbnail && { thumbnail: item.thumbnail }),
        }));

      // Convert to XML format to save tokens
      const xmlContent = searchResultsPrompt(searchContent);

      return { content: xmlContent, state: data, success: true };
    } catch (e) {
      return { content: (e as Error).message, error: e, success: false };
    }
  }

  async crawlSinglePage(
    args: CrawlSinglePageQuery,
    options?: { diagnosticId?: string },
  ): Promise<BuiltinServerRuntimeOutput> {
    return this.crawlMultiPages({ urls: [args.url] }, options);
  }

  async crawlMultiPages(
    args: CrawlMultiPagesQuery,
    options?: { diagnosticId?: string },
  ): Promise<BuiltinServerRuntimeOutput> {
    const params = { urls: args.urls };
    const response = options
      ? await this.searchService.crawlPages(params, options)
      : await this.searchService.crawlPages(params);

    const { results } = response;

    const content = results.map((item) =>
      'errorMessage' in item
        ? item
        : {
            ...item.data,
            // if crawl too many content
            // slice the top 10000 char
            content: item.data.content?.slice(0, CRAWL_CONTENT_LIMITED_COUNT),
          },
    );
    const xmlContent = crawlResultsPrompt(content as any);

    return {
      content: xmlContent,
      state: response,
      success: true,
    };
  }
}
