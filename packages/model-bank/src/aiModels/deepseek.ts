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
        { name: 'textInput_cacheRead', rate: 0.0028, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
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
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek-V4-Flash-Vision-Exp is an experimental multimodal model with V4-Flash text capabilities plus image input (JPEG, PNG, GIF, WebP). 1M context and up to 384K output. FIM is not supported.',
    displayName: 'DeepSeek V4 Flash Vision Exp',
    enabled: true,
    id: 'deepseek-v4-flash-vision-exp',
    maxOutput: 393_216,
    // Official rates are time-varying (peak vs off-peak). ChatHub has no schedule
    // dimension, so this card omits `pricing` rather than shipping a known-false
    // Flash copy. https://api-docs.deepseek.com/quick_start/pricing
    releasedAt: '2026-08-21',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
];

export default deepseekChatModels;
