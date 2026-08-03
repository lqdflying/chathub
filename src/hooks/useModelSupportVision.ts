import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

export const useModelSupportVision = (model: string, provider: string) => {
  const newValue = useAiInfraStore(aiModelSelectors.isModelSupportVision(model, provider));

  return newValue;
};
