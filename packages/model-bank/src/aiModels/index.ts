import { AIChatModelCard, AiFullModelCard, LobeDefaultAiModelListItem } from '../types/aiModel';
import { default as anthropic, anthropicRetiredChatModels } from './anthropic';
import {
  default as anthropiccompatible,
  anthropicCompatibleRetiredChatModels,
} from './anthropiccompatible';
import { default as azure } from './azure';
import { default as azureai } from './azureai';
import { default as deepseek } from './deepseek';
import { default as google } from './google';
import { default as mimo } from './mimo';
import { default as minimax } from './minimax';
import { default as moonshot } from './moonshot';
import { default as openai } from './openai';
import { default as openaicompatible } from './openaicompatible';
import { default as xai } from './xai';
import { default as zhipu } from './zhipu';

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
  mimo,
  minimax,
  moonshot,
  openai,
  openaicompatible,
  xai,
  zhipu,
});

type RetiredModelCard = AIChatModelCard & { providerId: string };

const RETIRED_MODEL_LIST: RetiredModelCard[] = Object.entries({
  anthropic: anthropicRetiredChatModels,
  anthropiccompatible: anthropicCompatibleRetiredChatModels,
}).flatMap(([providerId, models]) => models.map((model) => ({ ...model, providerId })));

/**
 * Last shipped card for an id that left the built-in picker but still works
 * upstream. Use it only when a saved assistant references the id and no
 * enabled card exists; never list these as built-in models.
 */
export const findRetiredModelCard = (
  id: string,
  providerId?: string,
): RetiredModelCard | undefined =>
  RETIRED_MODEL_LIST.find(
    (model) => model.id === id && (!providerId || model.providerId === providerId),
  );

export {
  default as anthropic,
  anthropicChatModels,
  anthropicRetiredChatModels,
} from './anthropic';
export {
  default as anthropiccompatible,
  anthropicCompatibleRetiredChatModels,
} from './anthropiccompatible';
export { default as azure } from './azure';
export { default as azureai } from './azureai';
export { default as deepseek } from './deepseek';
export { default as google, googleChatModels } from './google';
export { default as mimo } from './mimo';
export { default as minimax } from './minimax';
export { default as moonshot } from './moonshot';
export { default as openai } from './openai';
export { gptImage1ParamsSchema, openaiChatModels } from './openai';
export { default as openaicompatible } from './openaicompatible';
export {
  GPT_IMAGE_2_SIZE_PRESETS,
  gptImage2CompatibleParamsSchema,
  OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS,
} from './openaicompatible';
export { default as xai } from './xai';
export { default as zhipu } from './zhipu';
