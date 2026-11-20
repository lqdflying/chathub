import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';
import {
  GPT_IMAGE_2_SIZE_PRESETS,
  gptImage2CompatibleParamsSchema,
  openaiChatModels,
} from './openai';

export { GPT_IMAGE_2_SIZE_PRESETS, gptImage2CompatibleParamsSchema } from './openai';

const compatibleChatModelIds = ['gpt-6.2-astra', 'gpt-6.1-sol'];
const retiredCompatibleChatModelIds = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.5'];

const toCompatibleChatModel = (modelId: string): AIChatModelCard => {
  const sourceModel = openaiChatModels.find((model) => model.id === modelId)!;
  const settings = { ...sourceModel.settings };
  delete settings.searchProvider;

  return {
    ...sourceModel,
    abilities: {
      ...sourceModel.abilities,
      search: false,
    },
    enabled: true,
    settings,
  };
};

/**
 * Former fixed-list cards. Assistants that saved one of these ids keep its abilities, window,
 * gear params, and pricing through `findRetiredModelCard`; never list them as built-in models.
 */
export const openaicompatibleRetiredChatModels: AIChatModelCard[] =
  retiredCompatibleChatModelIds.map(toCompatibleChatModel);

const openaicompatibleModels: Array<AIChatModelCard | AIImageModelCard> = [
  ...compatibleChatModelIds.map(toCompatibleChatModel),
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
