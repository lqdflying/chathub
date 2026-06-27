import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';
import { gptImage1ParamsSchema, openaiChatModels } from './openai';

const gpt55 = openaiChatModels.find((model) => model.id === 'gpt-5.5')!;
const { searchImpl: _searchImpl, searchProvider: _searchProvider, ...gpt55Settings } =
  gpt55.settings ?? {};

const openaicompatibleModels: Array<AIChatModelCard | AIImageModelCard> = [
  {
    ...gpt55,
    abilities: {
      ...gpt55.abilities,
      search: false,
    },
    enabled: true,
    settings: gpt55Settings,
  },
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
