import { ModelProvider } from 'model-bank';

import {
  normalizeOpenAICompatCacheConfig,
  normalizeOpenAICompatResponsesParamsConfig,
  type AiProviderConfig,
} from '@/types/aiProvider';

export const openAICompatStoreValue = (store?: 'default' | 'false' | 'true') => {
  if (store === 'true') return true;
  if (store === 'false') return false;
  return undefined;
};

export interface OpenAICompatibleChatRoute {
  apiMode?: 'responses';
  openAICompatCache?: ReturnType<typeof normalizeOpenAICompatCacheConfig>;
  openAICompatResponsesParams?: ReturnType<typeof normalizeOpenAICompatResponsesParamsConfig>;
  responseStateMode?: 'provider';
  store?: boolean;
}

/**
 * Shared OpenAI-compatible routing for browser `getChatCompletion` and Graphile
 * conversation jobs. Compatible stays Chat Completions unless the provider
 * Responses radio is on (or the caller already set `apiMode`).
 */
export const resolveOpenAICompatibleChatRoute = ({
  explicitApiMode,
  provider,
  providerConfig,
}: {
  explicitApiMode?: string;
  provider: string;
  providerConfig?: AiProviderConfig;
}): OpenAICompatibleChatRoute => {
  if (provider === ModelProvider.Xai) {
    const configuredApiMode = providerConfig?.enableResponseApi === true ? 'responses' : undefined;
    const resolvedApiMode = explicitApiMode || configuredApiMode;
    return resolvedApiMode === 'responses' ? { apiMode: 'responses' } : {};
  }

  if (provider !== ModelProvider.OpenAICompatible) {
    return {};
  }

  const configuredApiMode = providerConfig?.enableResponseApi === true ? 'responses' : undefined;
  const resolvedApiMode = explicitApiMode || configuredApiMode;
  const apiMode = resolvedApiMode === 'responses' ? 'responses' : undefined;
  const openAICompatCache = normalizeOpenAICompatCacheConfig(providerConfig);
  const openAICompatResponsesParams = normalizeOpenAICompatResponsesParamsConfig(providerConfig);
  const responseCache = openAICompatCache.responses;
  const responseCacheEnabled = responseCache?.promptCacheKey === 'derived';
  const responseStateMode =
    apiMode === 'responses' && responseCacheEnabled ? ('provider' as const) : undefined;
  const store = apiMode === 'responses' ? openAICompatStoreValue(responseCache?.store) : undefined;

  const route: OpenAICompatibleChatRoute = {
    openAICompatCache,
    openAICompatResponsesParams,
  };
  if (apiMode) route.apiMode = apiMode;
  if (responseStateMode) route.responseStateMode = responseStateMode;
  if (store !== undefined) route.store = store;
  return route;
};
