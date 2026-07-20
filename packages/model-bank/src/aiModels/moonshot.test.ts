import { describe, expect, it } from 'vitest';

import moonshotChatModels from './moonshot';

describe('Moonshot model catalogue', () => {
  it('defines Kimi K3 as an enabled forced-reasoning multimodal model', () => {
    const kimiK3 = moonshotChatModels.find((model) => model.id === 'kimi-k3');

    expect(kimiK3).toMatchObject({
      abilities: {
        functionCall: true,
        reasoning: true,
        structuredOutput: true,
        video: true,
        vision: true,
      },
      contextWindowTokens: 1_048_576,
      displayName: 'Kimi K3',
      enabled: true,
      maxOutput: 1_048_576,
      pricing: {
        currency: 'USD',
        units: [
          { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        ],
      },
      type: 'chat',
    });
    expect(kimiK3?.settings?.extendParams).toBeUndefined();
  });
});
