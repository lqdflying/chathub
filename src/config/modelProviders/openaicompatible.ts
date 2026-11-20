import { ModelProvider } from 'model-bank';

import { ModelProviderCard } from '@/types/llm';

const OpenAICompatible: ModelProviderCard = {
  chatModels: [
    {
      contextWindowTokens: 1_050_000,
      description:
        'GPT-6.2 Astra through an OpenAI-compatible Chat Completions or Responses gateway.',
      displayName: 'GPT-6.2 Astra',
      enabled: true,
      functionCall: true,
      id: 'gpt-6.2-astra',
      maxOutput: 128_000,
      reasoning: true,
      releasedAt: '2026-11-17',
      search: false,
      vision: true,
    },
    {
      contextWindowTokens: 1_050_000,
      description:
        'GPT-6.1 Sol through an OpenAI-compatible Chat Completions or Responses gateway.',
      displayName: 'GPT-6.1 Sol',
      enabled: true,
      functionCall: true,
      id: 'gpt-6.1-sol',
      maxOutput: 128_000,
      reasoning: true,
      releasedAt: '2026-09-29',
      search: false,
      vision: true,
    },
  ],
  checkModel: 'gpt-6.1-sol',
  description:
    'Connect to services that expose an OpenAI-compatible API. Uses a fixed GPT model list for chat and image generation.',
  disableBrowserRequest: true,
  id: ModelProvider.OpenAICompatible,
  modelList: { showModelFetcher: false },
  name: 'OpenAI Compatible',
  settings: {
    disableBrowserRequest: true,
    modelEditable: false,
    proxyUrl: {
      desc: 'Base URL of the OpenAI-compatible API, including /v1 if required by your gateway (e.g. https://llm.example.com/v1).',
      placeholder: 'https://your-gateway.example.com/v1',
      title: 'API proxy / base URL',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showAddNewModel: false,
    showModelFetcher: false,
    supportResponsesApi: true,
  },
  url: 'https://platform.openai.com/docs/api-reference',
};

export default OpenAICompatible;
