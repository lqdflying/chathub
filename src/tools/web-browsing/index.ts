import { BuiltinToolManifest } from '@lobechat/types';
import dayjs from 'dayjs';

import { systemPrompt } from './systemRole';

export const WebBrowsingApiName = {
  crawlMultiPages: 'crawlMultiPages',
  crawlSinglePage: 'crawlSinglePage',
  search: 'search',
};

export const WebBrowsingManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Search the web via a metasearch service. Use it to find sources, facts, and current information. Returns a JSON array of results (title, url, content snippet).',
      name: WebBrowsingApiName.search,
      parameters: {
        properties: {
          query: {
            description: 'The search query',
            type: 'string',
          },
          searchCategories: {
            description: 'Optional categories to scope the search',
            items: {
              enum: ['general', 'images', 'news', 'science', 'videos'],
              type: 'string',
            },
            type: 'array',
          },
          searchEngines: {
            description:
              'Optional specific engines to query; omit to let the metasearch choose',
            items: {
              enum: [
                'google',
                'bilibili',
                'bing',
                'duckduckgo',
                'npm',
                'pypi',
                'github',
                'arxiv',
                'google scholar',
                'z-library',
                'reddit',
                'imdb',
                'brave',
                'wikipedia',
                'pinterest',
                'unsplash',
                'vimeo',
                'youtube',
              ],
              type: 'string',
            },
            type: 'array',
          },
          searchTimeRange: {
            description: 'Optional recency window for results',
            enum: ['anytime', 'day', 'week', 'month', 'year'],
            type: 'string',
          },
        },
        required: ['query'],
        type: 'object',
      },
    },
    {
      description:
        'Retrieve the full content of a single web page. Returns a JSON object with title, content, url, and website.',
      name: WebBrowsingApiName.crawlSinglePage,
      parameters: {
        properties: {
          url: {
            description: 'The URL to crawl',
            type: 'string',
          },
        },
        required: ['url'],
        type: 'object',
      },
    },
    {
      description:
        'Retrieve the full content of several web pages in one call, for comparison or multi-source verification. Returns an array of JSON objects with title, content, url, and website.',
      name: WebBrowsingApiName.crawlMultiPages,
      parameters: {
        properties: {
          urls: {
            items: {
              description: 'The URLs to crawl',
              type: 'string',
            },
            type: 'array',
          },
        },
        required: ['urls'],
        type: 'object',
      },
    },
  ],
  identifier: 'lobe-web-browsing',
  meta: {
    avatar: '🌐',
    title: 'Web Browsing',
  },
  systemRole: systemPrompt(dayjs(new Date()).format('YYYY-MM-DD')),
  type: 'builtin',
};
