import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

export const useModelSupportReasoning = (model: string, provider: string) => {
  const newValue = useAiInfraStore(aiModelSelectors.isModelSupportReasoning(model, provider));

  return newValue;
};
