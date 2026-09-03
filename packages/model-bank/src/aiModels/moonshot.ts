import type { AIChatModelCard } from '../types/aiModel';

// https://platform.kimi.ai/docs/models
// https://platform.kimi.ai/docs/pricing/chat-k3
// https://platform.kimi.ai/docs/pricing/chat-k26
// https://platform.kimi.ai/docs/pricing/chat-k27-code
// kimi-k2.5 / moonshot-v1 / kimi-k2-* discontinued (k2.5 sunset 2026-08-31).
const moonshotChatModels: AIChatModelCard[] = [
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
      'Kimi K3 is a flagship multimodal reasoning model for long-horizon coding, knowledge work, and agent workflows with a 1M-token context window.',
    displayName: 'Kimi K3',
    enabled: true,
    id: 'kimi-k3',
    maxOutput: 1_048_576,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-16',
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
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.6 flagship chat model (256k context). Supports thinking on/off and optionally Preserved Thinking (`thinking.keep`) for multi-turn reasoning_content.',
    displayName: 'Kimi K2.6',
    enabled: true,
    id: 'kimi-k2.6',
    maxOutput: 32_768,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-20',
    settings: {
      extendParams: ['enableReasoning', 'moonshotPreservedReasoning'],
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
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.7 Code is a coding-focused agentic model. It uses forced thinking with preserved reasoning by default and supports image and video input.',
    displayName: 'Kimi K2.7 Code',
    enabled: true,
    id: 'kimi-k2.7-code',
    maxOutput: 32_768,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.19, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-12',
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
    contextWindowTokens: 262_144,
    description:
      'High-speed Kimi K2.7 Code variant (~180 tokens/s, up to 260 tokens/s in short context). Forced thinking, same 256k context as K2.7 Code.',
    displayName: 'Kimi K2.7 Code Highspeed',
    id: 'kimi-k2.7-code-highspeed',
    maxOutput: 32_768,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.38, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-12',
    type: 'chat',
  },
];

export default moonshotChatModels;
