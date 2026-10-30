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

const claudeAlwaysOnThinkingSettings = {
  extendParams: ['disableContextCaching', 'reasoningEffort'],
  searchImpl: 'params' as const,
};

// Specs: https://platform.claude.com/docs/en/models/overview
export const anthropicChatModels: AIChatModelCard[] = [
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
    settings: { ...claudeAlwaysOnThinkingSettings },
    type: 'chat',
  },
  {
    abilities: { ...claude5Abilities },
    contextWindowTokens: 1_000_000,
    description:
      'Claude Opus 5.5 is for long-running agentic coding and knowledge work. Adaptive thinking is always on; effort defaults to medium.',
    displayName: 'Claude Opus 5.5',
    enabled: true,
    id: 'claude-opus-5-5',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 8, '5m': 5 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-09-22',
    settings: { ...claudeAlwaysOnThinkingSettings },
    type: 'chat',
  },
  {
    abilities: { ...claude5Abilities },
    contextWindowTokens: 1_000_000,
    description:
      'Claude Sonnet 5.5 is the best combination of speed and intelligence. Adaptive thinking is always on.',
    displayName: 'Claude Sonnet 5.5',
    enabled: true,
    id: 'claude-sonnet-5-5',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 4, '5m': 2.5 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-09-28',
    settings: { ...claudeAlwaysOnThinkingSettings },
    type: 'chat',
  },
  {
    abilities: { ...claude5Abilities },
    contextWindowTokens: 1_000_000,
    description:
      'Claude Haiku 5.5 is for high-volume, latency-sensitive tasks such as classification, extraction, and routing. Adaptive thinking is on by default; effort defaults to medium.',
    displayName: 'Claude Haiku 5.5',
    enabled: true,
    id: 'claude-haiku-5-5',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.1, upTo: 100_000 },
            { rate: 0.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.5, upTo: 100_000 },
            { rate: 2.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.01, upTo: 100_000 },
            { rate: 0.05, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          lookup: { prices: { '1h': 0.2, '5m': 0.125 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-10-07',
    settings: { ...claude5Settings },
    type: 'chat',
  },
];

export const allModels = [...anthropicChatModels];

export default allModels;
