import { describe, expect, it } from 'vitest';

import { hashGenerationDebugValue } from '@/libs/logger/generationDebug';

import { classifyProviderErrorParam, readProviderErrorParam } from './providerErrorParam';

describe('readProviderErrorParam', () => {
  it('walks nested error.body.error.param', () => {
    expect(
      readProviderErrorParam({
        body: {
          error: { message: 'Param Incorrect', param: 'temperature must be within [0, 1.5]' },
        },
      }),
    ).toBe('temperature must be within [0, 1.5]');
  });

  it('returns undefined when param is empty', () => {
    expect(readProviderErrorParam({ error: { message: 'Invalid request parameters', param: '' } })).toBeUndefined();
  });
});

describe('classifyProviderErrorParam', () => {
  it('maps known Xiaomi operational params to enums', () => {
    expect(
      classifyProviderErrorParam(
        'web search tool found in the request body, but webSearchEnabled is false',
      ),
    ).toEqual({
      errorParamClass: 'web_search_disabled',
      errorParamHash: hashGenerationDebugValue(
        'web search tool found in the request body, but webSearchEnabled is false',
      ),
    });
    expect(classifyProviderErrorParam('temperature must be within [0, 1.5]').errorParamClass).toBe(
      'temperature_out_of_range',
    );
  });

  it('fingerprints unknown provider-controlled text as other', () => {
    const classified = classifyProviderErrorParam('PRIVATE_PROMPT_TEXT_FROM_PROVIDER');
    expect(classified.errorParamClass).toBe('other');
    expect(classified.errorParamHash).toBe(
      hashGenerationDebugValue('PRIVATE_PROMPT_TEXT_FROM_PROVIDER'),
    );
  });
});
