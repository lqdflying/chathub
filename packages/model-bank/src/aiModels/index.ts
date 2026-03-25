import { AiFullModelCard, LobeDefaultAiModelListItem } from '../types/aiModel';
import { default as anthropic } from './anthropic';
import { default as azure } from './azure';
import { default as azureai } from './azureai';
import { default as google } from './google';
import { default as minimax } from './minimax';
import { default as openai } from './openai';

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
  azure,
  azureai,
  google,
  minimax,
  openai,
});

export { default as anthropic } from './anthropic';
export { default as azure } from './azure';
export { default as azureai } from './azureai';
export { default as google } from './google';
export { default as minimax } from './minimax';
export { gptImage1ParamsSchema, default as openai, openaiChatModels } from './openai';
