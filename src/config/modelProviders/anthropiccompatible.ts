import { ModelProvider } from 'model-bank';

import { ModelProviderCard } from '@/types/llm';

const AnthropicCompatible: ModelProviderCard = {
  chatModels: [
    {
      contextWindowTokens: 200_000,
      description:
        'Claude Sonnet 4.6 through an Anthropic-compatible Messages API gateway.',
      displayName: 'Claude Sonnet 4.6',
      enabled: true,
      functionCall: true,
      id: 'claude-sonnet-4-6',
      maxOutput: 64_000,
      reasoning: true,
      releasedAt: '2026-02-17',
      vision: true,
    },
    {
      contextWindowTokens: 200_000,
      description:
        'Claude Opus 4.6 through an Anthropic-compatible Messages API gateway.',
      displayName: 'Claude Opus 4.6',
      enabled: true,
      functionCall: true,
      id: 'claude-opus-4-6',
      maxOutput: 128_000,
      reasoning: true,
      releasedAt: '2026-02-05',
      vision: true,
    },
  ],
  checkModel: 'claude-sonnet-4-6',
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
