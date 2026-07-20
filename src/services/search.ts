import { SearchQuery } from '@lobechat/types';

import { toolsClient } from '@/libs/trpc/client';
import { TOOLS_DIAGNOSTIC_CONTEXT_KEY } from '@/libs/trpc/client/tools';

class SearchService {
  search(query: string, optionalParams?: object) {
    return toolsClient.search.query.query({ optionalParams, query });
  }

  crawlPage(url: string) {
    return toolsClient.search.crawlPages.mutate({ urls: [url] });
  }

  crawlPages(params: { urls: string[] }, options?: { diagnosticId?: string }) {
    return toolsClient.search.crawlPages.mutate(
      params,
      options?.diagnosticId
        ? {
            context: { [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: options.diagnosticId },
          }
        : undefined,
    );
  }

  async webSearch(params: SearchQuery, options?: { diagnosticId?: string }) {
    return toolsClient.search.webSearch.query(
      params,
      options?.diagnosticId
        ? {
            context: { [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: options.diagnosticId },
          }
        : undefined,
    );
  }
}

export const searchService = new SearchService();
