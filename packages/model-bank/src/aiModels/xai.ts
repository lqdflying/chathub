import type { AIChatModelCard, Pricing } from '../types/aiModel';

/**
 * Official short-context rates from https://docs.x.ai/developers/pricing
 * (long-context ≥200k doubles input/cached/output).
 */
const grok45Pricing: Pricing = {
  currency: 'USD',
  units: [
    { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
  ],
};

const grok46Pricing: Pricing = {
  currency: 'USD',
  units: [
    { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
  ],
};

const grok43Pricing: Pricing = {
  currency: 'USD',
  units: [
    { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
  ],
};

const grokBuildPricing: Pricing = {
  currency: 'USD',
  units: [
    { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
  ],
};

const grokChatAbilities = {
  functionCall: true,
  reasoning: true,
  search: true,
  structuredOutput: true,
  vision: true,
} as const;

const grokSearchSettings = {
  searchImpl: 'params' as const,
};

const xaiChatModels: AIChatModelCard[] = [
  {
    abilities: { ...grokChatAbilities },
    contextWindowTokens: 500_000,
    description:
      'xAI flagship for code and agentic work. Reasoning effort low / medium / high (default) / xhigh; thinking cannot be disabled.',
    displayName: 'Grok 4.6',
    enabled: true,
    id: 'grok-4.6',
    pricing: grok46Pricing,
    releasedAt: '2026-09-14',
    settings: {
      extendParams: ['xaiReasoningEffort'],
      ...grokSearchSettings,
    },
    type: 'chat',
  },
  {
    abilities: { ...grokChatAbilities },
    contextWindowTokens: 500_000,
    description:
      'xAI coding and workflow model. Reasoning effort low / medium / high; leftover xhigh is sent as high.',
    displayName: 'Grok 4.5',
    enabled: true,
    id: 'grok-4.5',
    pricing: grok45Pricing,
    releasedAt: '2026-08-01',
    settings: {
      extendParams: ['xaiReasoningEffort'],
      ...grokSearchSettings,
    },
    type: 'chat',
  },
  {
    abilities: { ...grokChatAbilities },
    contextWindowTokens: 1_000_000,
    description:
      'Fast Grok with configurable reasoning none / low (default) / medium / high and a 1M context window.',
    displayName: 'Grok 4.3',
    enabled: true,
    id: 'grok-4.3',
    pricing: grok43Pricing,
    releasedAt: '2026-06-01',
    settings: {
      extendParams: ['xaiReasoningEffort'],
      ...grokSearchSettings,
    },
    type: 'chat',
  },
  {
    abilities: { ...grokChatAbilities },
    contextWindowTokens: 1_000_000,
    description:
      'Grok 4.20 dated reasoning snapshot. Thinking is on; xAI does not expose a configurable effort control on this id.',
    displayName: 'Grok 4.20 Reasoning (0309)',
    enabled: false,
    id: 'grok-4.20-0309-reasoning',
    pricing: grok43Pricing,
    releasedAt: '2026-03-09',
    settings: {
      ...grokSearchSettings,
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description: 'Grok 4.20 dated non-reasoning snapshot. Fast replies without a thinking pass.',
    displayName: 'Grok 4.20 Non-reasoning (0309)',
    enabled: false,
    id: 'grok-4.20-0309-non-reasoning',
    pricing: grok43Pricing,
    releasedAt: '2026-03-09',
    settings: {
      ...grokSearchSettings,
    },
    type: 'chat',
  },
  {
    abilities: { ...grokChatAbilities },
    contextWindowTokens: 256_000,
    description:
      'xAI coding-agent model. Thinking is on; there is no documented reasoning_effort control.',
    displayName: 'Grok Build 0.1',
    enabled: false,
    id: 'grok-build-0.1',
    pricing: grokBuildPricing,
    releasedAt: '2026-04-01',
    settings: {
      ...grokSearchSettings,
    },
    type: 'chat',
  },
];

export default xaiChatModels;
