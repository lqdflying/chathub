import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';

/** Non-hook context window size; mirrors useModelContextWindowTokens. */
export const getModelContextWindowTokens = (model: string, provider: string): number => {
  return aiModelSelectors.modelContextWindowTokens(model, provider)(getAiInfraStoreState()) as number;
};
