// @vitest-environment node
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { getModelPricing } from './getModelPricing';

describe('getModelPricing', () => {
  it('omits a cost estimate for DeepSeek V4 Flash Vision Exp until peak/off-peak policy exists', async () => {
    const card = LOBE_DEFAULT_MODEL_LIST.find(
      (item) => item.id === 'deepseek-v4-flash-vision-exp' && item.providerId === 'deepseek',
    );

    expect(card).toBeDefined();
    expect(card?.pricing).toBeUndefined();
    await expect(
      getModelPricing('deepseek-v4-flash-vision-exp', 'deepseek'),
    ).resolves.toBeUndefined();
  });

  it('still returns the listed DeepSeek V4 Flash fixed rates', async () => {
    await expect(getModelPricing('deepseek-v4-flash', 'deepseek')).resolves.toEqual({
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0028, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
      ],
    });
  });
});
