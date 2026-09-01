import { isMimoTokenPlanBaseURL } from '@lobechat/model-runtime';

const MODEL_NATIVE_SEARCH_DISABLED_PROVIDERS = new Set(['moonshot']);

export interface ModelNativeSearchDisableOptions {
  mimoTokenPlanEnv?: boolean;
}

/**
 * True when container `MIMO_PROXY_URL` is a Token Plan host. Hostname class
 * only; sourced from `serverConfig.mimoTokenPlanEnv` on the client.
 */
export const getMimoTokenPlanEnvHint = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.global_serverConfigStore?.getState()?.serverConfig?.mimoTokenPlanEnv);
};

/**
 * Providers whose model-native search ChatHub must not select.
 * Moonshot: `$web_search` is not offered. MiMo Token Plan: native
 * `{ type: web_search }` is omitted by the adapter (plugin gate), so native
 * search would silently run with no search at all.
 *
 * Settings `baseURL` wins when present. When it is empty, `mimoTokenPlanEnv`
 * covers environment-only Token Plan (`MIMO_PROXY_URL`).
 */
export const isModelNativeSearchDisabledProvider = (
  provider?: string,
  providerBaseURL?: string,
  options?: ModelNativeSearchDisableOptions,
) => {
  if (!provider) return false;
  if (MODEL_NATIVE_SEARCH_DISABLED_PROVIDERS.has(provider)) return true;
  if (provider !== 'mimo') return false;
  if (providerBaseURL) return isMimoTokenPlanBaseURL(providerBaseURL);
  return Boolean(options?.mimoTokenPlanEnv);
};
