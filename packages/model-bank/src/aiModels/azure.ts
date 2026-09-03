import { AIChatModelCard, AIImageModelCard } from '../types/aiModel';
import { gptImage2CompatibleParamsSchema } from './openai';

/**
 * Azure OpenAI / Foundry model IDs from
 * https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure
 *
 * Omit Azure subscription tariffs (billed in Azure, not OpenAI public rates).
 * `gpt-5.2` Foundry version is 2025-12-11 — drop by 2026-01-01 cutoff.
 */

const azureFoundryAbilities = {
  functionCall: true,
  reasoning: true,
  structuredOutput: true,
  vision: true,
} as const;

const azureFoundrySettings = {
  extendParams: ['gpt5ReasoningEffort', 'textVerbosity'] as const,
};

/** Shared Foundry GPT-5.x chat cards (no Azure deploymentName). */
export const azureFoundryChatModels: AIChatModelCard[] = [
  {
    abilities: { ...azureFoundryAbilities },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.6 Sol is the Azure OpenAI frontier model for complex professional work, coding, and agentic workflows.',
    displayName: 'GPT-5.6 Sol',
    enabled: true,
    id: 'gpt-5.6-sol',
    maxOutput: 128_000,
    releasedAt: '2026-07-09',
    settings: { ...azureFoundrySettings },
    type: 'chat',
  },
  {
    abilities: { ...azureFoundryAbilities },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.6 Terra is the mid-tier GPT-5.6 model for coding, professional work, and agentic workflows.',
    displayName: 'GPT-5.6 Terra',
    enabled: true,
    id: 'gpt-5.6-terra',
    maxOutput: 128_000,
    releasedAt: '2026-07-09',
    settings: { ...azureFoundrySettings },
    type: 'chat',
  },
  {
    abilities: { ...azureFoundryAbilities },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.6 Luna is the low-cost GPT-5.6 tier for high-volume tasks, classification, and sub-agents.',
    displayName: 'GPT-5.6 Luna',
    enabled: true,
    id: 'gpt-5.6-luna',
    maxOutput: 128_000,
    releasedAt: '2026-07-09',
    settings: { ...azureFoundrySettings },
    type: 'chat',
  },
  {
    abilities: { ...azureFoundryAbilities },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.5 is the Azure OpenAI frontier model for complex professional work, coding, and agentic workflows.',
    displayName: 'GPT-5.5',
    enabled: true,
    id: 'gpt-5.5',
    maxOutput: 128_000,
    releasedAt: '2026-04-24',
    settings: { ...azureFoundrySettings },
    type: 'chat',
  },
  {
    abilities: { ...azureFoundryAbilities },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.4 is a highly capable Azure OpenAI model for reasoning, instruction following, and multimodal understanding.',
    displayName: 'GPT-5.4',
    enabled: true,
    id: 'gpt-5.4',
    maxOutput: 128_000,
    releasedAt: '2026-03-05',
    settings: { ...azureFoundrySettings },
    type: 'chat',
  },
  {
    abilities: { ...azureFoundryAbilities },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.4 Pro is the premium GPT-5.4 tier for complex reasoning, coding, and multimodal tasks.',
    displayName: 'GPT-5.4 Pro',
    id: 'gpt-5.4-pro',
    maxOutput: 128_000,
    releasedAt: '2026-03-05',
    settings: { ...azureFoundrySettings },
    type: 'chat',
  },
  {
    abilities: { ...azureFoundryAbilities },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.4 mini balances speed and cost for well-defined coding, extraction, and agent tasks.',
    displayName: 'GPT-5.4 mini',
    enabled: true,
    id: 'gpt-5.4-mini',
    maxOutput: 128_000,
    releasedAt: '2026-03-17',
    settings: { ...azureFoundrySettings },
    type: 'chat',
  },
  {
    abilities: { ...azureFoundryAbilities },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.4 nano is the cheapest GPT-5.4-class model for classification, ranking, and high-volume sub-agents.',
    displayName: 'GPT-5.4 nano',
    id: 'gpt-5.4-nano',
    maxOutput: 128_000,
    releasedAt: '2026-03-17',
    settings: { ...azureFoundrySettings },
    type: 'chat',
  },
];

const azureChatModels: AIChatModelCard[] = azureFoundryChatModels.map((model) => ({
  ...model,
  config: { deploymentName: model.id },
}));

const azureImageModels: AIImageModelCard[] = [
  {
    description: 'GPT Image 2 generates and edits images from text and image input.',
    displayName: 'GPT Image 2',
    enabled: true,
    id: 'gpt-image-2',
    parameters: gptImage2CompatibleParamsSchema,
    releasedAt: '2026-04-21',
    type: 'image',
  },
];

export const allModels = [...azureChatModels, ...azureImageModels];

export default allModels;
