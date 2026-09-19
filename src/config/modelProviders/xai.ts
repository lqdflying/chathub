import { xai as xaiChatModels } from 'model-bank';

import { ModelProviderCard } from '@/types/llm';

import { toLegacyChatModelCards } from './toLegacyChatModelCards';

const Xai: ModelProviderCard = {
  apiKeyUrl: 'https://console.x.ai/team/default/api-keys',
  chatModels: toLegacyChatModelCards(xaiChatModels),
  checkModel: 'grok-4.6',
  description:
    'xAI builds Grok models for coding, agentic tool calling, and knowledge work. ChatHub talks to the official Console API or an optional SuperGrok device-code session.',
  disableBrowserRequest: true,
  id: 'xai',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://docs.x.ai/developers/models',
  name: 'xAI',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.x.ai/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://x.ai',
};

export default Xai;
