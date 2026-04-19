import { useMemo } from 'react';

import { createChatToolsEngine } from '@/helpers/toolEngineering';
import { useModelContextWindowTokens } from '@/hooks/useModelContextWindowTokens';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useTokenCount } from '@/hooks/useTokenCount';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

export interface EstimatedContextUsage {
  chatsToken: number;
  historySummaryToken: number;
  inputTokenCount: number;
  maxTokens: number;
  ratio: number;
  systemRoleToken: number;
  toolsToken: number;
  totalToken: number;
}

/** Same token accounting as the chat input token popover (debounced via useTokenCount). */
export const useEstimatedContextUsage = (): EstimatedContextUsage => {
  const [input, historySummary] = useChatStore((s) => [
    s.inputMessage,
    topicSelectors.currentActiveTopicSummary(s)?.content || '',
  ]);

  const [systemRole, model, provider] = useAgentStore((s) => [
    agentSelectors.currentAgentSystemRole(s),
    agentSelectors.currentAgentModel(s) as string,
    agentSelectors.currentAgentModelProvider(s) as string,
    agentChatConfigSelectors.historyCount(s),
    agentChatConfigSelectors.enableHistoryCount(s),
  ]);

  const [historyCount, enableHistoryCount] = useAgentStore((s) => [
    agentChatConfigSelectors.historyCount(s),
    agentChatConfigSelectors.enableHistoryCount(s),
    agentChatConfigSelectors.isAgentEnableSearch(s),
  ]);

  const maxTokens = useModelContextWindowTokens(model, provider);
  const canUseTool = useModelSupportToolUse(model, provider);
  const pluginIds = useAgentStore(agentSelectors.currentAgentPlugins);

  const toolsString = useToolStore((s) => {
    const toolsEngine = createChatToolsEngine({ model, provider });
    const { tools, enabledToolIds } = toolsEngine.generateToolsDetailed({
      model,
      provider,
      toolIds: pluginIds,
    });
    const schemaNumber = tools?.map((i) => JSON.stringify(i)).join('') || '';
    const pluginSystemRoles = toolSelectors.enabledSystemRoles(enabledToolIds)(s);
    return pluginSystemRoles + schemaNumber;
  });

  const toolsToken = useTokenCount(canUseTool ? toolsString : '');
  const inputTokenCount = useTokenCount(input);
  const messageFingerprint = useChatStore(chatSelectors.mainAIChatsMessageString);

  const chatsString = useMemo(() => {
    const chats = chatSelectors.mainAIChatsWithHistoryConfig(useChatStore.getState());
    return chats.map((chat) => chat.content).join('');
  }, [messageFingerprint, historyCount, enableHistoryCount]);

  const chatsToken = useTokenCount(chatsString) + inputTokenCount;
  const systemRoleToken = useTokenCount(systemRole);
  const historySummaryToken = useTokenCount(historySummary);
  const totalToken = systemRoleToken + historySummaryToken + toolsToken + chatsToken;
  const ratio = maxTokens > 0 ? totalToken / maxTokens : 0;

  return {
    chatsToken,
    historySummaryToken,
    inputTokenCount,
    maxTokens,
    ratio,
    systemRoleToken,
    toolsToken,
    totalToken,
  };
};
