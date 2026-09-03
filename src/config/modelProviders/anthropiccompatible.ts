import { ModelProvider } from 'model-bank';

import { ModelProviderCard } from '@/types/llm';

const AnthropicCompatible: ModelProviderCard = {
  chatModels: [
    {
      contextWindowTokens: 1_000_000,
      description:
        'Claude Sonnet 5 through an Anthropic-compatible Messages API gateway.',
      displayName: 'Claude Sonnet 5',
      enabled: true,
      functionCall: true,
      id: 'claude-sonnet-5',
      maxOutput: 128_000,
      reasoning: true,
      releasedAt: '2026-06-30',
      vision: true,
    },
    {
      contextWindowTokens: 1_000_000,
      description:
        'Claude Opus 5 through an Anthropic-compatible Messages API gateway.',
      displayName: 'Claude Opus 5',
      enabled: true,
      functionCall: true,
      id: 'claude-opus-5',
      maxOutput: 128_000,
      reasoning: true,
      releasedAt: '2026-07-24',
      vision: true,
    },
  ],
  checkModel: 'claude-sonnet-5',
  description:
    'Connect to services that expose the native Anthropic Messages API. Supports both Anthropic-style x-api-key and Bearer token authentication.',
  disableBrowserRequest: true,
  id: ModelProvider.AnthropicCompatible,
  modelList: { showModelFetcher: false },
  name: 'Anthropic Compatible',
  settings: {
    disableBrowserRequest: true,
    modelEditable: false,
    proxyUrl: {
      desc: 'Base URL of the Anthropic-compatible API. The runtime calls /v1/messages relative to this value.',
      placeholder: 'https://your-gateway.example.com',
      title: 'API proxy / base URL',
    },
    responseAnimation: 'smooth',
    sdkType: 'anthropic',
    showAddNewModel: false,
    showModelFetcher: false,
  },
  url: 'https://docs.anthropic.com/en/api/messages',
};

export default AnthropicCompatible;
