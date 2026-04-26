import { ChatModelCard, ModelProviderCard } from '@/types/llm';

import AnthropicProvider from './anthropic';
import AzureProvider from './azure';
import AzureAIProvider from './azureai';
import DeepSeekProvider from './deepseek';
import GoogleProvider from './google';
import MinimaxProvider from './minimax';
import MoonshotProvider from './moonshot';
import OpenAIProvider from './openai';
import OpenAICompatibleProvider from './openaicompatible';

/**
 * @deprecated
 */
export const LOBE_DEFAULT_MODEL_LIST: ChatModelCard[] = [
  OpenAIProvider.chatModels,
  GoogleProvider.chatModels,
  AnthropicProvider.chatModels,
].flat();

export const DEFAULT_MODEL_PROVIDER_LIST = [
  OpenAIProvider,
  { ...AzureProvider, chatModels: [] },
  AzureAIProvider,
  AnthropicProvider,
  DeepSeekProvider,
  GoogleProvider,
  MinimaxProvider,
  MoonshotProvider,
  OpenAICompatibleProvider,
];

export const filterEnabledModels = (provider: ModelProviderCard) => {
  return provider.chatModels.filter((v) => v.enabled).map((m) => m.id);
};

export const isProviderDisableBrowserRequest = (id: string) => {
  const provider = DEFAULT_MODEL_PROVIDER_LIST.find((v) => v.id === id && v.disableBrowserRequest);
  return !!provider;
};

export { default as AnthropicProviderCard } from './anthropic';
export { default as AzureProviderCard } from './azure';
export { default as AzureAIProviderCard } from './azureai';
export { default as DeepSeekProviderCard } from './deepseek';
export { default as GoogleProviderCard } from './google';
export { default as LobeHubProviderCard } from './lobehub';
export { default as MinimaxProviderCard } from './minimax';
export { default as MoonshotProviderCard } from './moonshot';
export { default as OpenAIProviderCard } from './openai';
export { default as OpenAICompatibleProviderCard } from './openaicompatible';
