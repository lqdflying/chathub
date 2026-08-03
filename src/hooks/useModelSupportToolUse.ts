import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

export const useModelSupportToolUse = (model: string, provider: string) => {
  const newValue = useAiInfraStore(aiModelSelectors.isModelSupportToolUse(model, provider));

  return newValue;
};
