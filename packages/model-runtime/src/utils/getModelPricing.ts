import type { Pricing } from 'model-bank';

/**
 * 1. First try to get pricing from the specified provider
 * 2. If not found, try to get pricing from other providers with the same model name
 *
 * TODO: Add a fallback provider priority list. When no provider is specified,
 * first try official providers, then other providers. Same applies to getFallbackModelProperty
 */
export async function getModelPricing(
  model: string,
  provider?: string,
): Promise<Pricing | undefined> {
  const { LOBE_DEFAULT_MODEL_LIST, findRetiredModelCard } = await import('model-bank');

  // 1. First try to get pricing from the specified provider
  if (provider) {
    const exactMatch = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.id === model && m.providerId === provider,
    );

    if (exactMatch?.pricing) {
      return exactMatch.pricing;
    }
  }

  // 2. If not found, try to get pricing from other providers with the same model name
  const fallbackMatch = LOBE_DEFAULT_MODEL_LIST.find((m) => m.id === model);

  if (fallbackMatch?.pricing) {
    return fallbackMatch.pricing;
  }

  // 3. Saved ids that left the built-in picker keep their last shipped pricing
  const retired = (provider && findRetiredModelCard(model, provider)) || findRetiredModelCard(model);
  return retired?.pricing;
}
