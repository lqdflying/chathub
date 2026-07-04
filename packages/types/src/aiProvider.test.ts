import { describe, expect, it } from 'vitest';

import {
  normalizeOpenAICompatCacheConfig,
  normalizeOpenAICompatResponsesParamsConfig,
} from './aiProvider';

describe('OpenAI-compatible provider config normalization', () => {
  it('expands a preset-only apikl.ai cache config to the verified matrix', () => {
    const cache = normalizeOpenAICompatCacheConfig({
      openAICompatCache: {
        preset: 'apikl.ai',
      },
    });

    expect(cache).toEqual({
      chat: {
        promptCacheKey: true,
        sessionHeader: false,
      },
      preset: 'apikl.ai',
      responses: {
        promptCacheKey: 'derived',
        sessionHeader: false,
        store: 'default',
      },
    });
  });

  it('keeps preset-specific Responses params when only the preset is saved', () => {
    const params = normalizeOpenAICompatResponsesParamsConfig({
      openAICompatCache: {
        preset: 'apikl.ai',
      },
    });

    expect(params).toEqual({
      maxOutputTokens: false,
      maxTokens: false,
      truncation: 'off',
      verbosity: 'text',
    });
  });

  it('ignores stale hidden matrix overrides for built-in presets', () => {
    const cache = normalizeOpenAICompatCacheConfig({
      openAICompatCache: {
        chat: {
          promptCacheKey: false,
          sessionHeader: true,
        },
        preset: 'apikl.ai',
        responses: {
          promptCacheKey: 'off',
          sessionHeader: true,
          store: 'true',
        },
      },
      openAICompatResponsesParams: {
        maxOutputTokens: true,
        maxTokens: true,
        truncation: 'auto',
        verbosity: 'both',
      },
    });
    const params = normalizeOpenAICompatResponsesParamsConfig({
      openAICompatCache: {
        preset: 'apikl.ai',
      },
      openAICompatResponsesParams: {
        maxOutputTokens: true,
        maxTokens: true,
        truncation: 'auto',
        verbosity: 'both',
      },
    });

    expect(cache).toEqual({
      chat: {
        promptCacheKey: true,
        sessionHeader: false,
      },
      preset: 'apikl.ai',
      responses: {
        promptCacheKey: 'derived',
        sessionHeader: false,
        store: 'default',
      },
    });
    expect(params).toEqual({
      maxOutputTokens: false,
      maxTokens: false,
      truncation: 'off',
      verbosity: 'text',
    });
  });

  it('keeps custom partial cache config on custom defaults', () => {
    const cache = normalizeOpenAICompatCacheConfig({
      openAICompatCache: {
        preset: 'custom',
        responses: {
          promptCacheKey: 'derived',
        },
      },
    });

    expect(cache).toEqual({
      chat: {
        promptCacheKey: false,
        sessionHeader: false,
      },
      preset: 'custom',
      responses: {
        promptCacheKey: 'derived',
        sessionHeader: false,
        store: 'default',
      },
    });
  });
});
