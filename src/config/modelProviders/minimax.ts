import { ModelProviderCard } from '@/types/llm';

const Minimax: ModelProviderCard = {
  chatModels: [
    {
      contextWindowTokens: 204_800,
      description:
        'The latest flagship model with self-evolution capabilities. Excels at complex task decomposition, Agent workflows, coding, and Office automation.',
      displayName: 'MiniMax M2.7',
      enabled: true,
      functionCall: true,
      id: 'MiniMax-M2.7',
      maxOutput: 131_072,
      reasoning: true,
      releasedAt: '2026-03-01',
      vision: true,
      search: true,
    },
    {
      contextWindowTokens: 204_800,
      description: 'Same capabilities as M2.7 with significantly faster inference speed.',
      displayName: 'MiniMax M2.7 Highspeed',
      enabled: false,
      functionCall: true,
      id: 'MiniMax-M2.7-highspeed',
      maxOutput: 131_072,
      reasoning: true,
      releasedAt: '2026-03-01',
    },
    {
      contextWindowTokens: 204_800,
      description:
        'Optimized for code generation and refactoring, delivering peak performance with ultimate value to master complex tasks.',
      displayName: 'MiniMax M2.5',
      enabled: false,
      functionCall: true,
      id: 'MiniMax-M2.5',
      maxOutput: 131_072,
      reasoning: true,
      releasedAt: '2026-02-12',
    },
    {
      contextWindowTokens: 204_800,
      description: 'Same performance as M2.5 with significantly faster inference.',
      displayName: 'MiniMax M2.5 Highspeed',
      enabled: false,
      functionCall: true,
      id: 'MiniMax-M2.5-highspeed',
      maxOutput: 131_072,
      reasoning: true,
      releasedAt: '2026-02-12',
    },
    {
      contextWindowTokens: 204_800,
      description:
        'Powerful multilingual programming capabilities, comprehensively upgraded programming experience.',
      displayName: 'MiniMax M2.1',
      enabled: false,
      functionCall: true,
      id: 'MiniMax-M2.1',
      maxOutput: 131_072,
      reasoning: true,
      releasedAt: '2025-12-23',
    },
    {
      contextWindowTokens: 204_800,
      description:
        'Powerful multilingual programming capabilities with faster and more efficient inference.',
      displayName: 'MiniMax M2.1 Highspeed',
      enabled: false,
      functionCall: true,
      id: 'MiniMax-M2.1-highspeed',
      maxOutput: 131_072,
      reasoning: true,
      releasedAt: '2025-12-23',
    },
    {
      contextWindowTokens: 204_800,
      description:
        'Powerful multilingual programming capabilities with faster and more efficient inference.',
      displayName: 'MiniMax M2.1 Lightning',
      enabled: false,
      functionCall: true,
      id: 'MiniMax-M2.1-Lightning',
      maxOutput: 131_072,
      reasoning: true,
      releasedAt: '2025-12-23',
    },
    {
      contextWindowTokens: 204_800,
      description:
        'Specialized for multi-character immersive roleplay and handling long conversation scenarios with natural dialogue.',
      displayName: 'MiniMax M2-Her',
      enabled: false,
      functionCall: true,
      id: 'MiniMax-M2-Her',
      maxOutput: 131_072,
      reasoning: true,
      releasedAt: '2026-02-20',
    },
    {
      contextWindowTokens: 204_800,
      description: 'Built for efficient coding and agent workflows.',
      displayName: 'MiniMax M2',
      enabled: false,
      functionCall: true,
      id: 'MiniMax-M2-Stable',
      maxOutput: 131_072,
      reasoning: true,
      releasedAt: '2025-10-27',
      search: true,
    },
  ],
  checkModel: 'MiniMax-M2.5',
  description:
    'MiniMax is a Chinese AI company providing advanced large language models with strong reasoning and coding capabilities.',
  disableBrowserRequest: true,
  enabled: true,
  id: 'minimax',
  modelList: { showModelFetcher: false },
  name: 'MiniMax',
  proxyUrl: {
    placeholder: 'https://api.minimax.io/v1',
  },
  settings: {
    proxyUrl: {
      placeholder: 'https://api.minimax.io/v1',
    },
    sdkType: 'openai',
  },
  url: 'https://www.minimaxi.com',
};

export default Minimax;
