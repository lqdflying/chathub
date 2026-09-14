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
  /** Agent ids with a dynamic-memory rollup in flight (survives UI unmounts). */
  assistantMemoryRollingAgentIds: string[];
  defaultAgentConfig: LobeAgentConfig;
  inboxAgentRequestScope?: string;
  inboxAgentScope?: string;
  isInboxAgentConfigInit: boolean;
  /**
   * Latest intended plugin list per session. Overlay is owned by a write token
   * plus account/store generation so a failed or stale job cannot mask a later
   * fetch or another account's inbox selections.
   */
  pendingAgentPlugins: Record<
    string,
    {
      accountScope: string;
      ownershipInvalidationGeneration: number;
      plugins: string[];
      scopeGeneration: number;
      token: number;
    }
  >;
  scopeGeneration: number;
  showAgentSetting: boolean;
  updateAgentChatConfigSignal?: AbortController;
  /** Latest in-flight public config write; not a cross-session abort slot. */
  updateAgentConfigSignal?: AbortController;
  /** Every in-flight public config-write controller so account reset can cancel all of them. */
  updateAgentConfigSignals: AbortController[];
}

export const initialAgentChatState: AgentState = {
  activeId: 'inbox',
  agentConfigInitMap: {},
  agentMap: {},
  assistantMemoryRollingAgentIds: [],
  defaultAgentConfig: DEFAULT_AGENT_CONFIG,
  inboxAgentRequestScope: undefined,
  inboxAgentScope: undefined,
  isInboxAgentConfigInit: false,
  pendingAgentPlugins: {},
  scopeGeneration: 0,
  showAgentSetting: false,
  updateAgentConfigSignals: [],
};
