import { AiFullModelCard, LobeDefaultAiModelListItem } from '../types/aiModel';
import { default as anthropic } from './anthropic';
import { default as anthropiccompatible } from './anthropiccompatible';
import { default as azure } from './azure';
import { default as azureai } from './azureai';
import { default as deepseek } from './deepseek';
import { default as google } from './google';
import { default as minimax } from './minimax';
import { default as moonshot } from './moonshot';
import { default as openai } from './openai';
import { default as openaicompatible } from './openaicompatible';

type ModelsMap = Record<string, AiFullModelCard[]>;

const buildDefaultModelList = (map: ModelsMap): LobeDefaultAiModelListItem[] => {
  let models: LobeDefaultAiModelListItem[] = [];

  Object.entries(map).forEach(([provider, providerModels]) => {
    const newModels = providerModels.map((model) => ({
      ...model,
      abilities: model.abilities ?? {},
      enabled: model.enabled || false,
      providerId: provider,
      source: 'builtin',
    }));
    models = models.concat(newModels);
  });

  return models;
};

export const LOBE_DEFAULT_MODEL_LIST = buildDefaultModelList({
  anthropic,
  anthropiccompatible,
  azure,
  azureai,
  deepseek,
  google,
  minimax,
  moonshot,
  openai,
  openaicompatible,
});

export { default as anthropic } from './anthropic';
export { default as anthropiccompatible } from './anthropiccompatible';
export { default as azure } from './azure';
export { default as azureai } from './azureai';
export { default as deepseek } from './deepseek';
export { default as google } from './google';
export { default as minimax } from './minimax';
export { default as moonshot } from './moonshot';
export { default as openai } from './openai';
export { default as openaicompatible } from './openaicompatible';
export { gptImage1ParamsSchema, openaiChatModels } from './openai';
export {
  GPT_IMAGE_2_SIZE_PRESETS,
  gptImage2CompatibleParamsSchema,
} from './openaicompatible';
