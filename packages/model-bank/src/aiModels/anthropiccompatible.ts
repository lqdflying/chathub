import type { AIChatModelCard } from '../types/aiModel';
import anthropicChatModels, { anthropicRetiredChatModels } from './anthropic';

const fixedModelIds = ['claude-sonnet-5-5', 'claude-opus-5-5'];
const retiredFixedModelIds = ['claude-sonnet-5', 'claude-opus-5'];

const pickModels = (models: AIChatModelCard[], ids: string[]) =>
  ids
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is AIChatModelCard => !!model);

const toCompatibleModel = (model: AIChatModelCard): AIChatModelCard => {
  const { searchProvider: _searchProvider, ...settings } = model.settings ?? {};

  return {
    ...model,
    abilities: {
      ...model.abilities,
      search: false,
    },
    settings,
  };
};

const anthropicCompatibleChatModels: AIChatModelCard[] = pickModels(
  anthropicChatModels,
  fixedModelIds,
).map((model) => ({ ...toCompatibleModel(model), enabled: true }));

/** Former fixed-list cards; see `anthropicRetiredChatModels`. */
export const anthropicCompatibleRetiredChatModels: AIChatModelCard[] = pickModels(
  anthropicRetiredChatModels,
  retiredFixedModelIds,
).map(toCompatibleModel);

export default anthropicCompatibleChatModels;
