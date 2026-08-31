import { ModelProviderCard } from '@/types/llm';

const Mimo: ModelProviderCard = {
  chatModels: [],
  checkModel: 'mimo-v2.5-pro',
  description:
    'Xiaomi MiMo is Xiaomi’s LLM platform. V2.5 Pro and V2.5 support deep thinking, function calling, structured output, and optional built-in web search over an OpenAI-compatible Chat Completions API.',
  disableBrowserRequest: true,
  id: 'mimo',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://mimo.mi.com/docs/en-US/quick-start/summary/model',
  name: 'Xiaomi MiMo',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.xiaomimimo.com/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://platform.xiaomimimo.com/',
};

export default Mimo;
