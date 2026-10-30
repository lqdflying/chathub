import { anthropicChatModels } from 'model-bank';

import { ModelProviderCard } from '@/types/llm';

import { toLegacyChatModelCards } from './toLegacyChatModelCards';

const Anthropic: ModelProviderCard = {
  chatModels: toLegacyChatModelCards(anthropicChatModels),
  checkModel: 'claude-sonnet-5-5',
  description:
    'Anthropic 是一家专注于人工智能研究和开发的公司，提供 Claude Fable、Opus、Sonnet 与 Haiku 等语言模型，覆盖长程智能体、编程、高速日常工作与大批量低延迟任务。',
  enabled: true,
  id: 'anthropic',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://platform.claude.com/docs/en/models/overview',
  name: 'Anthropic',
  proxyUrl: {
    placeholder: 'https://api.anthropic.com',
  },
  settings: {
    proxyUrl: {
      placeholder: 'https://api.anthropic.com',
    },
    responseAnimation: 'smooth',
    sdkType: 'anthropic',
    showModelFetcher: true,
  },
  url: 'https://anthropic.com',
};

export default Anthropic;
