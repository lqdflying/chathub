import { AIChatModelCard } from '../types/aiModel';

const claude5Abilities = {
  functionCall: true,
  reasoning: true,
  search: true,
  structuredOutput: true,
  vision: true,
} as const;

const claude5Settings = {
  extendParams: [
    'disableContextCaching',
    'enableReasoning',
    'reasoningEffort',
    'reasoningBudgetToken',
  ],
  searchImpl: 'params' as const,
};

// Specs: https://platform.claude.com/docs/en/models/overview
const anthropicChatModels: AIChatModelCard[] = [
  {
    abilities: { ...claude5Abilities },
    contextWindowTokens: 1_000_000,
    description:
      'Claude Fable 5.1 is Anthropic’s most capable generally available model for long-horizon agentic coding, knowledge work, and research. Adaptive thinking is always on.',
    displayName: 'Claude Fable 5.1',
    enabled: true,
    id: 'claude-fable-5-1',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 50, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 20, '5m': 12.5 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-09-01',
    settings: { ...claude5Settings },
    type: 'chat',
  },
  {
    abilities: { ...claude5Abilities },
    contextWindowTokens: 1_000_000,
    description:
      'Claude Opus 5 is for complex agentic coding and enterprise work. Adaptive thinking is on by default.',
    displayName: 'Claude Opus 5',
    enabled: true,
    id: 'claude-opus-5',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 10, '5m': 6.25 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-07-24',
    settings: { ...claude5Settings },
    type: 'chat',
  },
  {
    abilities: { ...claude5Abilities },
    contextWindowTokens: 1_000_000,
    description:
      'Claude Sonnet 5 is the best combination of speed and intelligence. Adaptive thinking is on by default.',
    displayName: 'Claude Sonnet 5',
    enabled: true,
    id: 'claude-sonnet-5',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 4, '5m': 2.5 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-06-30',
    settings: { ...claude5Settings },
    type: 'chat',
  },
  {
    abilities: { ...claude5Abilities },
    contextWindowTokens: 1_000_000,
    description:
      'Claude Opus 4.8 remains available as a 2026 Opus generation. Prefer Claude Opus 5 for new work.',
    displayName: 'Claude Opus 4.8',
    id: 'claude-opus-4-8',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 10, '5m': 6.25 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-05-28',
    settings: { ...claude5Settings },
    type: 'chat',
  },
  {
    abilities: { ...claude5Abilities },
    contextWindowTokens: 200_000,
    description:
      "Claude Opus 4.7 is Anthropic's most intelligent flagship model, designed for building agents and complex coding tasks, with exceptional reasoning and adaptive thinking.",
    displayName: 'Claude Opus 4.7',
    enabled: true,
    id: 'claude-opus-4-7',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 10, '5m': 6.25 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-17',
    settings: { ...claude5Settings },
    type: 'chat',
  },
  {
    abilities: { ...claude5Abilities },
    contextWindowTokens: 200_000,
    description:
      "Claude Opus 4.6 is Anthropic's most intelligent flagship model, designed for building agents and complex coding tasks, with exceptional reasoning and adaptive thinking.",
    displayName: 'Claude Opus 4.6',
    id: 'claude-opus-4-6',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 10, '5m': 6.25 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-05',
    settings: { ...claude5Settings },
    type: 'chat',
  },
  {
    abilities: { ...claude5Abilities },
    contextWindowTokens: 200_000,
    description:
      'Claude Sonnet 4.6 is the best balance of speed and intelligence from Anthropic, delivering stronger reasoning and adaptive thinking at the same price as Sonnet 4.5.',
    displayName: 'Claude Sonnet 4.6',
    enabled: true,
    id: 'claude-sonnet-4-6',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 6, '5m': 3.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-17',
    settings: { ...claude5Settings },
    type: 'chat',
  },
];

export const allModels = [...anthropicChatModels];

export default allModels;
