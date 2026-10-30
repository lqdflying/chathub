// @vitest-environment node
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { getModelPricing } from './getModelPricing';

describe('getModelPricing', () => {
  it('omits a cost estimate for deepseek-flash until peak/off-peak policy exists', async () => {
    const card = LOBE_DEFAULT_MODEL_LIST.find(
      (item) => item.id === 'deepseek-flash' && item.providerId === 'deepseek',
    );

    expect(card).toBeDefined();
    expect(card?.displayName).toBe('deepseek-flash');
    expect(card?.pricing).toBeUndefined();
    await expect(getModelPricing('deepseek-flash', 'deepseek')).resolves.toBeUndefined();
  });

  it('keeps the last shipped pricing for a retired Claude id', async () => {
    expect(LOBE_DEFAULT_MODEL_LIST.some((item) => item.id === 'claude-sonnet-5')).toBe(false);

    const pricing = await getModelPricing('claude-sonnet-5', 'anthropic');
    expect(pricing?.units).toEqual(
      expect.arrayContaining([
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ]),
    );
    await expect(getModelPricing('claude-sonnet-5', 'anthropiccompatible')).resolves.toEqual(
      pricing,
    );
    await expect(getModelPricing('claude-unknown', 'anthropic')).resolves.toBeUndefined();
  });
});
