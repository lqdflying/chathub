import { ModelParamsSchema } from '../standard-parameters';
import { AIChatModelCard, AIImageModelCard } from '../types';

/**
 * gemini implicit caching not extra cost
 * https://openrouter.ai/docs/features/prompt-caching#implicit-caching
 *
 * Flash/Lite 3.x rates are introductory vs standard (time-varying through 2026-12-31).
 * Omit those tariffs rather than invent an average.
 * Official catalogue: https://ai.google.dev/gemini-api/docs/models
 */

const gemini3FlashAbilities = {
  functionCall: true,
  reasoning: true,
  search: true,
  structuredOutput: true,
  video: true,
  vision: true,
} as const;

const gemini3FlashSettings = {
  extendParams: ['thinkingBudget', 'urlContext'] as const,
  searchImpl: 'params' as const,
  searchProvider: 'google' as const,
};

const googleChatModels: AIChatModelCard[] = [
  {
    abilities: { ...gemini3FlashAbilities },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      "Gemini 3.8 Flash is Google's most intelligent Flash model for long-horizon software engineering, autonomous agents, and complex enterprise workflows.",
    displayName: 'Gemini 3.8 Flash',
    enabled: true,
    id: 'gemini-3.8-flash',
    maxOutput: 65_536,
    releasedAt: '2026-09-02',
    settings: { ...gemini3FlashSettings },
    type: 'chat',
  },
  {
    abilities: { ...gemini3FlashAbilities },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 3.7 Flash is the previous-generation Flash workhorse for complex coding, agentic workflows, and reliable multi-step execution.',
    displayName: 'Gemini 3.7 Flash',
    id: 'gemini-3.7-flash',
    maxOutput: 65_536,
    releasedAt: '2026-08-13',
    settings: { ...gemini3FlashSettings },
    type: 'chat',
  },
  {
    abilities: { ...gemini3FlashAbilities },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 3.6 Flash balances speed and multimodal capabilities across general agentic and everyday tasks.',
    displayName: 'Gemini 3.6 Flash',
    id: 'gemini-3.6-flash',
    maxOutput: 65_536,
    releasedAt: '2026-07-21',
    settings: { ...gemini3FlashSettings },
    type: 'chat',
  },
  {
    abilities: { ...gemini3FlashAbilities },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 3.5 Flash is a legacy Flash model for baseline speed and foundational high-throughput workloads.',
    displayName: 'Gemini 3.5 Flash',
    id: 'gemini-3.5-flash',
    maxOutput: 65_536,
    releasedAt: '2026-05-19',
    settings: { ...gemini3FlashSettings },
    type: 'chat',
  },
  {
    abilities: { ...gemini3FlashAbilities },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 3.5 Flash-Lite is a low-latency, cost-effective subagent model for high-volume automation.',
    displayName: 'Gemini 3.5 Flash-Lite',
    enabled: true,
    id: 'gemini-3.5-flash-lite',
    maxOutput: 65_536,
    releasedAt: '2026-07-21',
    settings: { ...gemini3FlashSettings },
    type: 'chat',
  },
  {
    abilities: { ...gemini3FlashAbilities },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 3.1 Flash-Lite is a cost-effective 2026 Flash-Lite model, still listed as stable until 2027-05-07.',
    displayName: 'Gemini 3.1 Flash-Lite',
    id: 'gemini-3.1-flash-lite',
    maxOutput: 65_536,
    releasedAt: '2026-05-07',
    settings: { ...gemini3FlashSettings },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      "Gemini 3.1 Pro is Google's most advanced thinking model with strong reasoning and multimodal capabilities, excelling in code, math, and STEM.",
    displayName: 'Gemini 3.1 Pro Preview',
    enabled: true,
    id: 'gemini-3.1-pro-preview',
    maxOutput: 65_536,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 200_000 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 12, upTo: 200_000 },
            { rate: 18, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-19',
    settings: { ...gemini3FlashSettings },
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 131_072 + 32_768,
    description:
      'Gemini 3.1 Flash Image (Nano Banana 2) generates and edits images in conversation with text and image input.',
    displayName: 'Gemini 3.1 Flash Image',
    enabled: true,
    id: 'gemini-3.1-flash-image',
    maxOutput: 32_768,
    releasedAt: '2026-05-28',
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 65_536 + 32_768,
    description:
      'Gemini 3 Pro Image (Nano Banana Pro) generates and edits images with Pro-class visual quality.',
    displayName: 'Gemini 3 Pro Image',
    enabled: true,
    id: 'gemini-3-pro-image',
    maxOutput: 32_768,
    releasedAt: '2026-05-28',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      imageOutput: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 65_536 + 4096,
    description:
      'Gemini 3.1 Flash-Lite Image is a lighter native image generation and editing model.',
    displayName: 'Gemini 3.1 Flash-Lite Image',
    id: 'gemini-3.1-flash-lite-image',
    maxOutput: 4096,
    releasedAt: '2026-06-01',
    type: 'chat',
  },
];

export const imagenGenParameters: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: ['1:1', '16:9', '9:16', '3:4', '4:3'],
  },
  prompt: { default: '' },
};

const NANO_BANANA_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
];

export const nanoBananaParameters: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: NANO_BANANA_ASPECT_RATIOS,
  },
  imageUrls: {
    default: [],
  },
  prompt: { default: '' },
};

/* eslint-disable sort-keys-fix/sort-keys-fix */
const googleImageModels: AIImageModelCard[] = [
  {
    displayName: 'Gemini 3.1 Flash Image',
    id: 'gemini-3.1-flash-image:image',
    enabled: true,
    type: 'image',
    description:
      'Gemini 3.1 Flash Image (Nano Banana 2) generates and edits images from text and image input.',
    releasedAt: '2026-05-28',
    parameters: nanoBananaParameters,
  },
  {
    displayName: 'Gemini 3 Pro Image',
    id: 'gemini-3-pro-image:image',
    enabled: true,
    type: 'image',
    description: 'Gemini 3 Pro Image (Nano Banana Pro) for higher-quality native image generation.',
    releasedAt: '2026-05-28',
    parameters: nanoBananaParameters,
  },
  {
    displayName: 'Gemini 3.1 Flash-Lite Image',
    id: 'gemini-3.1-flash-lite-image:image',
    type: 'image',
    description: 'Gemini 3.1 Flash-Lite Image for lighter native image generation and editing.',
    releasedAt: '2026-06-01',
    parameters: nanoBananaParameters,
  },
];
/* eslint-enable sort-keys-fix/sort-keys-fix */

export const allModels = [...googleChatModels, ...googleImageModels];

export default allModels;
