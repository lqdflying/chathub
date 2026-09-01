import { KnowledgeItem, KnowledgeType, LobeAgentChatConfig, LobeAgentConfig } from '@lobechat/types';
import { contextCachingModels, thinkingWithToolClaudeModels } from '@/const/models';
import { agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { sessionSelectors } from '@/store/session/selectors';
import { getSessionStoreState } from '@/store/session/store';

export type ConversationAgentRuntime = {
  agentConfig: LobeAgentConfig;
  chatConfig: LobeAgentChatConfig;
  enableHistoryCount: boolean;
  enabledKnowledge: KnowledgeItem[];
  isGroupSession: boolean;
  systemRole: string;
};

/** Enabled KB/files from a concrete agent config (not activeId). */
export const getEnabledKnowledgeFromConfig = (config: LobeAgentConfig): KnowledgeItem[] => {
  const knowledgeBases = config.knowledgeBases || [];
  const files = config.files || [];

  return [
    ...files
      .filter((f) => f.enabled)
      .map((f) => ({ fileType: f.type, id: f.id, name: f.name, type: KnowledgeType.File })),
    ...knowledgeBases
      .filter((k) => k.enabled)
      .map((k) => ({ id: k.id, name: k.name, type: KnowledgeType.KnowledgeBase })),
  ] as KnowledgeItem[];
};

/**
 * History-count gate for a concrete agent config. Mirrors
 * `agentChatConfigSelectors.enableHistoryCount` without reading `activeId`.
 */
export const resolveEnableHistoryCountForAgent = (config: LobeAgentConfig): boolean => {
  const chatConfig = config.chatConfig || {};
  const enableContextCaching = !chatConfig.disableContextCaching;

  if (enableContextCaching && contextCachingModels.has(config.model)) return false;

  const enableSearch = (chatConfig.searchMode || 'off') !== 'off';
  if (enableSearch && thinkingWithToolClaudeModels.has(config.model)) return false;

  return !!chatConfig.enableHistoryCount;
};

/**
 * Resolve model/provider/system/chat/knowledge/session-type for a conversation
 * session — including when the UI has navigated to a different session.
 * Used by deferred browser-fallback tool → model continuation.
 */
export const resolveConversationAgentRuntime = (sessionId: string): ConversationAgentRuntime => {
  const agentConfig = agentSelectors.getAgentConfigById(sessionId)(getAgentStoreState());
  const chatConfig = agentConfig.chatConfig || {};
  const session = sessionSelectors.getSessionById(sessionId)(getSessionStoreState());

  return {
    agentConfig,
    chatConfig,
    enableHistoryCount: resolveEnableHistoryCountForAgent(agentConfig),
    enabledKnowledge: getEnabledKnowledgeFromConfig(agentConfig),
    isGroupSession: session?.type === 'group',
    systemRole: agentConfig.systemRole || '',
  };
};
