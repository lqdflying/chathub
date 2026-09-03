import type { AIChatModelCard } from 'model-bank';

import type { ChatModelCard } from '@/types/llm';

/** Map model-bank chat cards onto the deprecated provider-card ChatModelCard shape. */
export const toLegacyChatModelCards = (models: AIChatModelCard[]): ChatModelCard[] =>
  models.map((model) => ({
    contextWindowTokens: model.contextWindowTokens,
    description: model.description,
    displayName: model.displayName,
    enabled: model.enabled,
    functionCall: model.abilities?.functionCall,
    id: model.id,
    imageOutput: model.abilities?.imageOutput,
    maxOutput: model.maxOutput,
    pricing: model.pricing,
    reasoning: model.abilities?.reasoning,
    releasedAt: model.releasedAt,
    search: model.abilities?.search,
    type: model.type,
    video: model.abilities?.video,
    vision: model.abilities?.vision,
  }));
