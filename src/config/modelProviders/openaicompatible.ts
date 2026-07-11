import { ModelProvider } from 'model-bank';

import { ModelProviderCard } from '@/types/llm';

const OpenAICompatible: ModelProviderCard = {
  chatModels: [
    {
      contextWindowTokens: 1_050_000,
      description:
        'GPT-5.6 Sol through an OpenAI-compatible Chat Completions or Responses gateway.',
      displayName: 'GPT-5.6 Sol',
      enabled: true,
      functionCall: true,
      id: 'gpt-5.6-sol',
      maxOutput: 128_000,
      reasoning: true,
      releasedAt: '2026-07-09',
      search: false,
      vision: true,
    },
    {
      contextWindowTokens: 1_050_000,
      description:
        'GPT-5.5 through an OpenAI-compatible Chat Completions gateway.',
      displayName: 'GPT-5.5',
      enabled: true,
      functionCall: true,
      id: 'gpt-5.5',
      maxOutput: 128_000,
      reasoning: true,
      releasedAt: '2026-04-23',
      search: false,
      vision: true,
    },
  ],
  checkModel: 'gpt-5.5',
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
