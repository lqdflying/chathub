import type { PartialDeep } from 'type-fest';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { AgentSettingsInstance } from '@/features/AgentSetting';
import { LobeAgentConfig } from '@/types/agent';

export interface AgentState {
  activeAgentId?: string;
  activeId: string;
  agentConfigInitMap: Record<string, boolean>;
  agentMap: Record<string, PartialDeep<LobeAgentConfig>>;
  agentSettingInstance?: AgentSettingsInstance | null;
  defaultAgentConfig: LobeAgentConfig;
  inboxAgentRequestScope?: string;
  inboxAgentScope?: string;
  isInboxAgentConfigInit: boolean;
  scopeGeneration: number;
  showAgentSetting: boolean;
  updateAgentChatConfigSignal?: AbortController;
  updateAgentConfigSignal?: AbortController;
}

export const initialAgentChatState: AgentState = {
  activeId: 'inbox',
  agentConfigInitMap: {},
  agentMap: {},
  defaultAgentConfig: DEFAULT_AGENT_CONFIG,
  inboxAgentRequestScope: undefined,
  inboxAgentScope: undefined,
  isInboxAgentConfigInit: false,
  scopeGeneration: 0,
  showAgentSetting: false,
};
