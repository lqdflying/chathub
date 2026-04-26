import { ModelProviderCard } from '@/types/llm';

const DeepSeek: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-v4-pro',
  description:
    'DeepSeek, a leading AI research company, offers powerful reasoning models with long-context capabilities, supporting thinking mode, function calling, and structured output.',
  disableBrowserRequest: true,
  id: 'deepseek',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://platform.deepseek.com/pricing',
  name: 'DeepSeek',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.deepseek.com',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.deepseek.com/',
};

export default DeepSeek;
