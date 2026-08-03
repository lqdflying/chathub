import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

export const useModelSupportFiles = (model: string, provider: string) => {
  const newValue = useAiInfraStore(aiModelSelectors.isModelSupportFiles(model, provider));

  return newValue;
};
