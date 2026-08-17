import type {
  ConversationGenerationConfigSnapshot,
  LobeAgentConfig,
  LobeAgentChatConfig,
} from '@lobechat/types';

import type { IFeatureFlagsState } from '@/config/featureFlags';

interface DurableAgentConfig {
  chatConfig?: Partial<LobeAgentChatConfig> | null;
  model: string;
  params?: LobeAgentConfig['params'] | Record<string, unknown> | null;
  plugins?: string[] | null;
  provider: string;
  systemRole?: string | null;
}

export const buildDurableConversationConfig = ({
  activatedSkillIds,
  agentConfig,
  chatConfig,
  enableMemoryTool,
  fetchOnClient,
  historySummary,
  historySummaryLastMessageId,
  isWelcomeQuestion,
  locale,
  ragQuery,
  systemRole,
}: {
  activatedSkillIds?: string[];
  agentConfig: DurableAgentConfig;
  chatConfig?: Partial<LobeAgentChatConfig>;
  enableMemoryTool?: boolean;
  fetchOnClient?: boolean;
  historySummary?: string;
  historySummaryLastMessageId?: string;
  isWelcomeQuestion?: boolean;
  locale?: string;
  ragQuery?: string;
  systemRole?: string;
}): ConversationGenerationConfigSnapshot => ({
  activatedSkillIds: activatedSkillIds?.length
    ? [...new Set(activatedSkillIds)]
    : undefined,
  agentParams: (agentConfig.params as Record<string, unknown> | undefined) || undefined,
  chatConfig: chatConfig || agentConfig.chatConfig || undefined,
  enableMemoryTool,
  fetchOnClient,
  historySummary,
  historySummaryLastMessageId,
  isWelcomeQuestion,
  locale,
  model: agentConfig.model,
  plugins: agentConfig.plugins || undefined,
  provider: agentConfig.provider,
  ragQuery,
  systemRole: systemRole ?? agentConfig.systemRole ?? undefined,
});

export const isClientDurableConversationGenerationEnabled = () => {
  if (typeof window === 'undefined') return false;
  const flags = window.global_serverConfigStore?.getState()?.featureFlags as
    | IFeatureFlagsState
    | undefined;
  return flags?.enableDurableConversationGeneration === true;
};
