import { isMimoTokenPlanBaseURL } from '@lobechat/model-runtime';

const MODEL_NATIVE_SEARCH_DISABLED_PROVIDERS = new Set(['moonshot']);

/**
 * Providers whose model-native search ChatHub must not select.
 * Moonshot: `$web_search` is not offered. MiMo Token Plan: native
 * `{ type: web_search }` is omitted by the adapter (plugin gate), so native
 * search would silently run with no search at all.
 */
export const isModelNativeSearchDisabledProvider = (
  provider?: string,
  providerBaseURL?: string,
) => {
  if (!provider) return false;
  if (MODEL_NATIVE_SEARCH_DISABLED_PROVIDERS.has(provider)) return true;
  return provider === 'mimo' && isMimoTokenPlanBaseURL(providerBaseURL);
};
