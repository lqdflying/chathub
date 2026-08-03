import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/slices/chat';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

export const useModelHasContextWindowToken = () => {
  const model = useAgentStore(agentSelectors.currentAgentModel);
  const provider = useAgentStore(agentSelectors.currentAgentModelProvider);
  const newValue = useAiInfraStore(aiModelSelectors.isModelHasContextWindowToken(model, provider));

  return newValue;
};
