import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';
import {
  GPT_IMAGE_2_SIZE_PRESETS,
  gptImage2CompatibleParamsSchema,
  openaiChatModels,
} from './openai';

export { GPT_IMAGE_2_SIZE_PRESETS, gptImage2CompatibleParamsSchema } from './openai';

const compatibleChatModelIds = ['gpt-5.6-sol', 'gpt-5.5'];

// Compatible gateways use a smaller shared context budget than native OpenAI.
export const OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS = 258_000;

const openaicompatibleModels: Array<AIChatModelCard | AIImageModelCard> = [
  ...compatibleChatModelIds.map((modelId) => {
    const sourceModel = openaiChatModels.find((model) => model.id === modelId)!;
    const settings = { ...sourceModel.settings };
    delete settings.searchProvider;

    return {
      ...sourceModel,
      abilities: {
        ...sourceModel.abilities,
        search: false,
      },
      contextWindowTokens: OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS,
      enabled: true,
      settings,
    };
  }),
  {
    description:
      'OpenAI-compatible image generation model for gateways exposing GPT Image 2 through the Images API.',
    displayName: 'GPT Image 2',
    enabled: true,
    id: 'gpt-image-2',
    parameters: gptImage2CompatibleParamsSchema,
    releasedAt: '2026-04-21',
    resolutions: [...GPT_IMAGE_2_SIZE_PRESETS],
    type: 'image',
  },
];

export default openaicompatibleModels;
