import { describe, expect, it } from 'vitest';

import OpenAICompatible from './openaicompatible';

describe('OpenAICompatible provider card', () => {
  it('exposes fixed models and the Responses API switch', () => {
    expect(OpenAICompatible.chatModels.map((model) => model.id)).toEqual([
      'gpt-6.2-astra',
      'gpt-6.1-sol',
    ]);
    expect(OpenAICompatible.chatModels[0]).toMatchObject({
      contextWindowTokens: 1_050_000,
      displayName: 'GPT-6.2 Astra',
      maxOutput: 128_000,
      reasoning: true,
      releasedAt: '2026-11-17',
      search: false,
      vision: true,
    });
    expect(OpenAICompatible.chatModels.find((model) => model.id === 'gpt-6.1-sol')).toMatchObject({
      contextWindowTokens: 1_050_000,
      displayName: 'GPT-6.1 Sol',
      maxOutput: 128_000,
      reasoning: true,
      releasedAt: '2026-09-29',
      search: false,
      vision: true,
    });
    expect(OpenAICompatible.chatModels.every((model) => model.search === false)).toBe(true);
    expect(OpenAICompatible.checkModel).toBe('gpt-6.1-sol');
    expect(OpenAICompatible.modelList?.showModelFetcher).toBe(false);
    expect(OpenAICompatible.settings).toMatchObject({
      modelEditable: false,
      showAddNewModel: false,
      showModelFetcher: false,
      supportResponsesApi: true,
    });
  });
});
