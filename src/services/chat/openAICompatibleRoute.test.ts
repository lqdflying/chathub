import { describe, expect, it } from 'vitest';

import { resolveOpenAICompatibleChatRoute } from './openAICompatibleRoute';

describe('resolveOpenAICompatibleChatRoute', () => {
  it('returns no route fields for other providers', () => {
    expect(
      resolveOpenAICompatibleChatRoute({
        provider: 'openai',
        providerConfig: { enableResponseApi: true },
      }),
    ).toEqual({});
  });

  it('omits apiMode when the Responses radio is off', () => {
    const route = resolveOpenAICompatibleChatRoute({
      provider: 'openaicompatible',
      providerConfig: { enableResponseApi: false },
    });

    expect(route).not.toHaveProperty('apiMode');
    expect(route).not.toHaveProperty('store');
    expect(route.openAICompatCache).toBeDefined();
  });

  it('sets Responses routing from the provider radio', () => {
    const route = resolveOpenAICompatibleChatRoute({
      provider: 'openaicompatible',
      providerConfig: { enableResponseApi: true },
    });

    expect(route.apiMode).toBe('responses');
  });

  it('sets Responses routing for native xAI without OpenAI-compat cache fields', () => {
    expect(
      resolveOpenAICompatibleChatRoute({
        provider: 'xai',
        providerConfig: { enableResponseApi: true },
      }),
    ).toEqual({ apiMode: 'responses' });

    expect(
      resolveOpenAICompatibleChatRoute({
        provider: 'xai',
        providerConfig: { enableResponseApi: false },
      }),
    ).toEqual({});
  });

  it('lets an explicit apiMode override the radio', () => {
    expect(
      resolveOpenAICompatibleChatRoute({
        explicitApiMode: 'responses',
        provider: 'openaicompatible',
        providerConfig: { enableResponseApi: false },
      }).apiMode,
    ).toBe('responses');
  });
});
