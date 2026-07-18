import { describe, expect, it } from 'vitest';

import {
  normalizeOpenAICompatCacheConfig,
  normalizeOpenAICompatResponsesParamsConfig,
} from './aiProvider';

describe('OpenAI-compatible provider config normalization', () => {
  it('expands prompt-key-store to the shared built-in matrix', () => {
    const cache = normalizeOpenAICompatCacheConfig({
      openAICompatCache: {
        preset: 'prompt-key-store',
      },
    });

    expect(cache).toEqual({
      chat: {
        promptCacheKey: true,
        sessionHeader: false,
      },
      preset: 'prompt-key-store',
      responses: {
        promptCacheKey: 'derived',
        sessionHeader: false,
        store: 'true',
      },
    });
  });

  it('omits Responses extra params for the shared built-in preset', () => {
    const params = normalizeOpenAICompatResponsesParamsConfig({
      openAICompatCache: {
        preset: 'prompt-key-store',
      },
    });

    expect(params).toEqual({
      maxOutputTokens: false,
      maxTokens: false,
      reasoningEffort: 'reasoning',
      truncation: 'off',
      verbosity: 'off',
    });
  });

  it.each(['apikl.ai', 'pptoken.org'] as const)(
    'normalizes legacy %s preset to prompt-key-store',
    (preset) => {
      const cache = normalizeOpenAICompatCacheConfig({
        openAICompatCache: {
          preset,
        },
      });

      expect(cache).toEqual({
        chat: {
          promptCacheKey: true,
          sessionHeader: false,
        },
        preset: 'prompt-key-store',
        responses: {
          promptCacheKey: 'derived',
          sessionHeader: false,
          store: 'true',
        },
      });
    },
  );

  it('ignores stale hidden matrix overrides for built-in presets', () => {
    const cache = normalizeOpenAICompatCacheConfig({
      openAICompatCache: {
        chat: {
          promptCacheKey: false,
          sessionHeader: true,
        },
        preset: 'prompt-key-store',
        responses: {
          promptCacheKey: 'off',
          sessionHeader: true,
          store: 'default',
        },
      },
      openAICompatResponsesParams: {
        maxOutputTokens: true,
        maxTokens: true,
        reasoningEffort: 'both',
        truncation: 'auto',
        verbosity: 'both',
      },
    });
    const params = normalizeOpenAICompatResponsesParamsConfig({
      openAICompatCache: {
        preset: 'prompt-key-store',
      },
      openAICompatResponsesParams: {
        maxOutputTokens: true,
        maxTokens: true,
        reasoningEffort: 'both',
        truncation: 'auto',
        verbosity: 'both',
      },
    });

    expect(cache).toEqual({
      chat: {
        promptCacheKey: true,
        sessionHeader: false,
      },
      preset: 'prompt-key-store',
      responses: {
        promptCacheKey: 'derived',
        sessionHeader: false,
        store: 'true',
      },
    });
    expect(params).toEqual({
      maxOutputTokens: false,
      maxTokens: false,
      reasoningEffort: 'reasoning',
      truncation: 'off',
      verbosity: 'off',
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

  it('defaults custom reasoning effort mode to reasoning object', () => {
    const params = normalizeOpenAICompatResponsesParamsConfig({
      openAICompatCache: {
        preset: 'custom',
      },
    });

    expect(params).toEqual({
      maxOutputTokens: false,
      maxTokens: false,
      reasoningEffort: 'reasoning',
      truncation: 'off',
      verbosity: 'off',
    });
  });

  it('keeps custom reasoning effort overrides', () => {
    const params = normalizeOpenAICompatResponsesParamsConfig({
      openAICompatCache: {
        preset: 'custom',
      },
      openAICompatResponsesParams: {
        reasoningEffort: 'top-level',
      },
    });

    expect(params).toEqual({
      maxOutputTokens: false,
      maxTokens: false,
      reasoningEffort: 'top-level',
      truncation: 'off',
      verbosity: 'off',
    });
  });
});
