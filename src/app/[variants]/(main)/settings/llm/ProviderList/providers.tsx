import { useMemo } from 'react';

import {
  AnthropicProviderCard,
  GoogleProviderCard,
  MinimaxProviderCard,
} from '@/config/modelProviders';

import { ProviderItem } from '../type';
import { useAzureProvider } from './Azure';
import { useOpenAIProvider } from './OpenAI';

export const useProviderList = (): ProviderItem[] => {
  const AzureProvider = useAzureProvider();
  const OpenAIProvider = useOpenAIProvider();

  return useMemo(
    () => [
      OpenAIProvider,
      AzureProvider,
      AnthropicProviderCard,
      GoogleProviderCard,
      MinimaxProviderCard,
    ],
    [AzureProvider, OpenAIProvider],
  );
};
