import { getServerFeatureFlagsStateFromEdgeConfig } from '@/server/featureFlags';

export const isDurableConversationGenerationEnabled = async (userId?: string) => {
  const flags = await getServerFeatureFlagsStateFromEdgeConfig(userId);
  return flags.enableDurableConversationGeneration === true;
};
