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
});
