import { describe, expect, it } from 'vitest';

import OpenAICompatible from './openaicompatible';

describe('OpenAICompatible provider card', () => {
  it('exposes fixed models and the Responses API switch', () => {
    expect(OpenAICompatible.chatModels.map((model) => model.id)).toEqual(['gpt-5.5']);
    expect(OpenAICompatible.chatModels[0]).toMatchObject({ search: false });
    expect(OpenAICompatible.modelList?.showModelFetcher).toBe(false);
    expect(OpenAICompatible.settings).toMatchObject({
      modelEditable: false,
      showAddNewModel: false,
      showModelFetcher: false,
      supportResponsesApi: true,
    });
  });
});
