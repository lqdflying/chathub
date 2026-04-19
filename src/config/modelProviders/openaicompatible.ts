import { ModelProvider } from 'model-bank';

import { ModelProviderCard } from '@/types/llm';

const OpenAICompatible: ModelProviderCard = {
  chatModels: [],
  checkModel: 'minimaxai/minimax-m2.7',
  description:
    'Connect to any service that exposes an OpenAI-compatible Chat Completions HTTP API. Set the API base URL (usually ending in /v1), your API key, and add or fetch model names your server provides.',
  disableBrowserRequest: true,
  id: ModelProvider.OpenAICompatible,
  modelList: { showModelFetcher: true },
  name: 'OpenAI Compatible',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      desc: 'Base URL of the OpenAI-compatible API, including /v1 if required by your gateway (e.g. https://llm.example.com/v1 or http://localhost:11434/v1).',
      placeholder: 'https://your-gateway.example.com/v1',
      title: 'API proxy / base URL',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://platform.openai.com/docs/api-reference',
};

export default OpenAICompatible;
