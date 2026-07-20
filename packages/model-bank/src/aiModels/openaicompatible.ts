import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';
import { gptImage1ParamsSchema, openaiChatModels } from './openai';

const compatibleChatModelIds = ['gpt-5.6-sol', 'gpt-5.5'];

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
      contextWindowTokens: 258_000,
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
    parameters: gptImage1ParamsSchema,
    resolutions: ['1024x1024', '1024x1536', '1536x1024'],
    type: 'image',
  },
];

export default openaicompatibleModels;
