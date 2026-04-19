import { isDeprecatedEdition } from '@/const/version';
import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { modelProviderSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';

/** Non-hook context window size; mirrors useModelContextWindowTokens. */
export const getModelContextWindowTokens = (model: string, provider: string): number => {
  if (isDeprecatedEdition) {
    return modelProviderSelectors.modelMaxToken(model)(getUserStoreState()) as number;
  }
  return aiModelSelectors.modelContextWindowTokens(model, provider)(getAiInfraStoreState()) as number;
};
