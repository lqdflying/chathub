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
 * The "Use the model's built-in search engine" toggle starts on for these providers,
 * whose built-in search runs server-side. `anthropiccompatible` is left out: a
 * third-party gateway may not run Anthropic's `web_search` server tool.
 */
const MODEL_BUILTIN_SEARCH_DEFAULT_ON_PROVIDERS = new Set(['anthropic', 'deepseek']);

/** A saved choice wins over the provider default. */
export const resolveUseModelBuiltinSearch = (provider?: string, saved?: boolean): boolean =>
  saved ?? (!!provider && MODEL_BUILTIN_SEARCH_DEFAULT_ON_PROVIDERS.has(provider));

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
