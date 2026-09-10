import type { AIChatModelCard } from '../types/aiModel';

// https://api-docs.deepseek.com/quick_start/pricing
const deepseekChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek-V4.1-Flash is a multimodal reasoning model with native image input (JPEG, PNG, GIF, WebP), 1M context window, and up to 384K output tokens. Supports thinking mode, function calling, and JSON output.',
    displayName: 'DeepSeek V4.1 Flash',
    enabled: true,
    id: 'deepseek-flash',
    maxOutput: 393_216,
    // Official rates are time-varying (peak vs off-peak). ChatHub has no schedule
    // dimension, so this card omits `pricing` rather than shipping a known-false
    // average. https://api-docs.deepseek.com/quick_start/pricing
    releasedAt: '2026-09-10',
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
      'DeepSeek-V4-Pro is a flagship reasoning model with 1M context window and up to 384K output tokens. Supports thinking mode, function calling, and JSON output.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.003625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.435, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.87, strategy: 'fixed', unit: 'millionTokens' },
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
