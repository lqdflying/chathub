import { ModelProviderCard } from '@/types/llm';

const LobeHub: ModelProviderCard = {
  chatModels: [],
  description: 'ChatHub Cloud 提供开箱即用的 AI 模型调用，通过积分制简化大语言模型的使用与计费。',
  enabled: true,
  id: 'lobehub',
  modelsUrl: 'https://chathub.dev/docs/usage/subscription/model-pricing',
  name: 'ChatHub',
  settings: {
    modelEditable: false,
    showAddNewModel: false,
    showModelFetcher: false,
  },
  showConfig: false,
  url: 'https://lobehub.com',
};

export default LobeHub;

export const planCardModels = ['gpt-4o-mini', 'deepseek-reasoner', 'claude-3-5-sonnet-latest'];
