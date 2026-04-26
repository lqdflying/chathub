import type { AIChatModelCard } from '../types/aiModel';

// https://platform.deepseek.com/
const deepseekChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek-V4-Pro is a flagship reasoning model with 1M context window and up to 384K output tokens. Supports thinking mode, function calling, and JSON output.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-01',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek-V4-Flash is a high-speed variant of the V4 series with 1M context window and up to 384K output tokens. Balances speed and quality.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    id: 'deepseek-v4-flash',
    maxOutput: 393_216,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-01',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
];

export default deepseekChatModels;
