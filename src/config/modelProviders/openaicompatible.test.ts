import { describe, expect, it } from 'vitest';

import OpenAICompatible from './openaicompatible';

describe('OpenAICompatible provider card', () => {
  it('exposes fixed models and the Responses API switch', () => {
    expect(OpenAICompatible.chatModels.map((model) => model.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.5',
    ]);
    expect(OpenAICompatible.chatModels[0]).toMatchObject({
      contextWindowTokens: 1_050_000,
      displayName: 'GPT-5.6 Sol',
      maxOutput: 128_000,
      reasoning: true,
      releasedAt: '2026-07-09',
      search: false,
      vision: true,
    });
    expect(OpenAICompatible.chatModels.every((model) => model.search === false)).toBe(true);
    expect(OpenAICompatible.checkModel).toBe('gpt-5.5');
    expect(OpenAICompatible.modelList?.showModelFetcher).toBe(false);
    expect(OpenAICompatible.settings).toMatchObject({
      modelEditable: false,
      showAddNewModel: false,
      showModelFetcher: false,
      supportResponsesApi: true,
    });
  });
});
