import type { AIChatModelCard } from '../types/aiModel';

// https://mimo.mi.com/docs/zh-CN/quick-start/summary/model
// https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go
// https://mimo.mi.com/docs/en-US/api/chat/openai-api
const MIMO_V25_SUNSET = 'Xiaomi removes this model id at 2026-10-21 10:00 UTC+8.';

const mimoChatModels: AIChatModelCard[] = [
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
      'MiMo-V2.6-Pro is Xiaomi MiMo’s flagship omni-modal model: images, video, audio, and text with a 1M context window, deep thinking, function calling, structured output, and optional built-in web search.',
    displayName: 'MiMo V2.6 Pro',
    enabled: true,
    id: 'mimo-v2.6-pro',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0036, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.435, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.87, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-21',
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
      'MiMo-V2.6-Flash is Xiaomi MiMo’s full-modal model for high-frequency work: images, video, audio, and text with a 1M context window, deep thinking, function calling, structured output, and optional built-in web search.',
    displayName: 'MiMo V2.6 Flash',
    enabled: true,
    id: 'mimo-v2.6-flash',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0028, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-21',
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
      'MiMo-V2.6-Pro-UltraSpeed serves the same full-modal V2.6 Pro capabilities at up to 20× output speed. Pay-as-you-go rates are 10× V2.6 Pro. 1M context, deep thinking, function calling, structured output, and optional built-in web search.',
    displayName: 'MiMo V2.6 Pro UltraSpeed',
    enabled: true,
    id: 'mimo-v2.6-pro-ultraspeed',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.036, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-21',
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
    },
    contextWindowTokens: 1_048_576,
    description: `MiMo-V2.5-Pro is Xiaomi MiMo’s flagship text model with a 1M context window, deep thinking, function calling, structured output, and optional built-in web search. ${MIMO_V25_SUNSET}`,
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
    description: `MiMo-V2.5 is Xiaomi MiMo’s omni-modal model: images, video, audio, and text with a 1M context window, deep thinking, function calling, structured output, and optional built-in web search. ${MIMO_V25_SUNSET}`,
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
