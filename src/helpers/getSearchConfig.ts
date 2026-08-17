import {
  type ModelSearchConfig,
  resolveModelSearchConfig,
} from '@/services/chat/requestShaping';
import { getAgentStoreState } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra/selectors';

/**
 * Search configuration result
 */
export type SearchConfig = ModelSearchConfig;

/**
 * Get search configuration for given model and provider
 * This centralizes the search logic that was duplicated across multiple places
 */
export const getSearchConfig = (model: string, provider: string): SearchConfig => {
  const chatConfig = agentChatConfigSelectors.currentChatConfig(getAgentStoreState());
  const aiInfraStoreState = getAiInfraStoreState();
  const isProviderHasBuiltinSearch =
    aiProviderSelectors.isProviderHasBuiltinSearch(provider)(aiInfraStoreState);
  const modelSearchImpl = aiModelSelectors.modelBuiltinSearchImpl(
    model,
    provider,
  )(aiInfraStoreState);

  return resolveModelSearchConfig({
    modelSearchImpl,
    provider,
    providerHasBuiltinSearch: isProviderHasBuiltinSearch,
    searchMode: chatConfig.searchMode,
    useModelBuiltinSearch: chatConfig.useModelBuiltinSearch,
  });
};
