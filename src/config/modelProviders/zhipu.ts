import { ModelProviderCard } from '@/types/llm';

const Zhipu: ModelProviderCard = {
  chatModels: [],
  checkModel: 'glm-5.2',
  description:
    'Zhipu AI (智谱) provides the GLM flagship model family with Deep Thinking, a 1M-token context on GLM-5.2, built-in web search, and function calling.',
  disableBrowserRequest: true,
  id: 'zhipu',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://docs.z.ai/api-reference/llm/chat-completion',
  name: 'Zhipu (智谱)',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://open.bigmodel.cn/api/paas/v4',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.zhipuai.cn/',
};

export default Zhipu;
