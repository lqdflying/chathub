import type { AIChatModelCard } from '../types/aiModel';
import anthropicChatModels from './anthropic';

const fixedModelIds = ['claude-sonnet-5', 'claude-opus-5'];

const anthropicCompatibleChatModels: AIChatModelCard[] = fixedModelIds
  .map((id) => anthropicChatModels.find((model) => model.id === id))
  .filter(Boolean)
  .map((model) => {
    const { searchProvider: _searchProvider, ...settings } =
      model!.settings ?? {};

    return {
      ...model!,
      abilities: {
        ...model!.abilities,
        search: false,
      },
      enabled: true,
      settings,
    };
  });

export default anthropicCompatibleChatModels;
