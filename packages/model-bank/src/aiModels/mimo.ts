import type { AIChatModelCard } from '../types/aiModel';

// https://mimo.mi.com/docs/en-US/quick-start/summary/model
// https://mimo.mi.com/docs/en-US/price/pay-as-you-go
const mimoChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'MiMo-V2.5-Pro is Xiaomi MiMo’s flagship text model with a 1M context window, deep thinking, function calling, structured output, and optional built-in web search.',
    displayName: 'MiMo V2.5 Pro',
    enabled: true,
    id: 'mimo-v2.5-pro',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0036, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.435, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.87, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-22',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'MiMo-V2.5 is Xiaomi MiMo’s omni-modal model: images, video, audio, and text with a 1M context window, deep thinking, function calling, structured output, and optional built-in web search.',
    displayName: 'MiMo V2.5',
    enabled: true,
    id: 'mimo-v2.5',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0028, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-22',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

export default mimoChatModels;
