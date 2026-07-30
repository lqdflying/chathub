import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';
import type { ModelParamsSchema } from '../standard-parameters';
import { gptImage1ParamsSchema, openaiChatModels } from './openai';

const compatibleChatModelIds = ['gpt-5.6-sol', 'gpt-5.5'];

// Compatible gateways use a smaller shared context budget than native OpenAI.
export const OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS = 258_000;

export const GPT_IMAGE_2_SIZE_PRESETS = [
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2560x1440',
  '1440x2560',
  '3840x2160',
  '2160x3840',
] as const;

export const gptImage2CompatibleParamsSchema: ModelParamsSchema = {
  ...gptImage1ParamsSchema,
  size: {
    custom: {
      experimentalPixelThreshold: 3_686_400,
      maxAspectRatio: 3,
      maxEdge: 3840,
      maxPixels: 8_294_400,
      minPixels: 655_360,
      step: 16,
    },
    default: 'auto',
    enum: [...GPT_IMAGE_2_SIZE_PRESETS],
    groups: [
      { key: 'standard', values: ['1024x1024', '1536x1024', '1024x1536'] },
      { key: '2k', values: ['2560x1440', '1440x2560'] },
      { key: '4k', values: ['3840x2160', '2160x3840'] },
    ],
  },
};

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
    resolutions: [...GPT_IMAGE_2_SIZE_PRESETS],
    type: 'image',
  },
];

export default openaicompatibleModels;
