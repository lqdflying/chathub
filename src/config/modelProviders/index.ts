import { ChatModelCard, ModelProviderCard } from '@/types/llm';

import AnthropicProvider from './anthropic';
import AnthropicCompatibleProvider from './anthropiccompatible';
import AzureProvider from './azure';
import AzureAIProvider from './azureai';
import DeepSeekProvider from './deepseek';
import GoogleProvider from './google';
import MinimaxProvider from './minimax';
import MimoProvider from './mimo';
import MoonshotProvider from './moonshot';
import OpenAIProvider from './openai';
import OpenAICompatibleProvider from './openaicompatible';
import ZhipuProvider from './zhipu';

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
  AnthropicCompatibleProvider,
  DeepSeekProvider,
  GoogleProvider,
  MinimaxProvider,
  MimoProvider,
  MoonshotProvider,
  OpenAICompatibleProvider,
  ZhipuProvider,
];

export const filterEnabledModels = (provider: ModelProviderCard) => {
  return provider.chatModels.filter((v) => v.enabled).map((m) => m.id);
};

export const isProviderDisableBrowserRequest = (id: string) => {
  const provider = DEFAULT_MODEL_PROVIDER_LIST.find((v) => v.id === id && v.disableBrowserRequest);
  return !!provider;
};

export { default as AnthropicProviderCard } from './anthropic';
export { default as AnthropicCompatibleProviderCard } from './anthropiccompatible';
export { default as AzureProviderCard } from './azure';
export { default as AzureAIProviderCard } from './azureai';
export { default as DeepSeekProviderCard } from './deepseek';
export { default as GoogleProviderCard } from './google';
export { default as LobeHubProviderCard } from './lobehub';
export { default as MinimaxProviderCard } from './minimax';
export { default as MimoProviderCard } from './mimo';
export { default as MoonshotProviderCard } from './moonshot';
export { default as OpenAIProviderCard } from './openai';
export { default as OpenAICompatibleProviderCard } from './openaicompatible';
export { default as ZhipuProviderCard } from './zhipu';
