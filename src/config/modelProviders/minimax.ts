import { ModelProviderCard } from '@/types/llm';

const Minimax: ModelProviderCard = {
  chatModels: [],
  checkModel: 'MiniMax-M3',
  description:
    'MiniMax is a Chinese AI company providing advanced large language models with strong reasoning and coding capabilities.',
  disableBrowserRequest: true,
  enabled: true,
  id: 'minimax',
  modelList: { showModelFetcher: true },
  name: 'MiniMax',
  proxyUrl: {
    placeholder: 'https://api.minimax.io/v1',
  },
  settings: {
    proxyUrl: {
      placeholder: 'https://api.minimax.io/v1',
    },
    showModelFetcher: true,
    sdkType: 'openai',
  },
  url: 'https://www.minimaxi.com',
};

export default Minimax;
