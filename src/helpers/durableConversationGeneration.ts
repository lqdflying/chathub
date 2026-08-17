import type { IFeatureFlagsState } from '@/config/featureFlags';

export const isClientDurableConversationGenerationEnabled = () => {
  if (typeof window === 'undefined') return false;
  const flags = window.global_serverConfigStore?.getState()?.featureFlags as
    | IFeatureFlagsState
    | undefined;
  return flags?.enableDurableConversationGeneration === true;
};
