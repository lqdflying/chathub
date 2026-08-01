import { agentMemoryPrompt } from '@lobechat/prompts';
import { useMemo } from 'react';

import { normalizeAssistantMemoryText } from '@/helpers/assistantMemory';
import { selectMessagesForContext } from '@/helpers/contextCompaction';
import { buildHistorySummaryForRequest } from '@/helpers/memoryArchivePrompt';
import { createChatToolsEngine } from '@/helpers/toolEngineering';
import { useModelContextWindowTokens } from '@/hooks/useModelContextWindowTokens';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useTokenCount } from '@/hooks/useTokenCount';
import { composeSystemRole } from '@/services/chat/composeSystemRole';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatSelectors, threadSelectors, topicSelectors } from '@/store/chat/selectors';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

export interface EstimatedContextUsage {
  chatInstructionToken: number;
  chatsToken: number;
  historySummaryToken: number;
  inputTokenCount: number;
  maxTokens: number;
  memoryToken: number;
  ratio: number;
  roleSettingsToken: number;
  systemRoleToken: number;
  toolsToken: number;
  totalToken: number;
}

export type EstimatedContextConversationSource = 'main' | 'portal';

/** Same token accounting as the chat input token popover (debounced via useTokenCount). */
export const useEstimatedContextUsage = (
  conversationSource: EstimatedContextConversationSource = 'main',
): EstimatedContextUsage => {
  const [input, historySummary, memoryArchives, historySummaryLastMessageId, isRegularTopic] =
    useChatStore((s) => [
      s.inputMessage,
      topicSelectors.currentActiveTopicSummary(s)?.content,
      topicSelectors.currentActiveTopic(s)?.metadata?.memoryArchives,
      topicSelectors.currentActiveTopic(s)?.metadata?.historySummaryLastMessageId,
      s.activeSessionType !== 'group' && !s.activeThreadId && !s.portalThreadId,
    ]);

  const [systemRole, model, provider, assistantMemory, fixedMemory, enableAssistantMemory] =
    useAgentStore((s) => [
      agentSelectors.currentAgentSystemRole(s),
      agentSelectors.currentAgentModel(s) as string,
      agentSelectors.currentAgentModelProvider(s) as string,
      agentSelectors.currentAgentConfig(s).assistantMemory ?? '',
      agentSelectors.currentAgentConfig(s).fixedMemory ?? '',
      agentChatConfigSelectors.enableAssistantMemory(s),
    ]);

  const [historyCount, enableHistoryCount, enableCompressHistory, enableUserMemoryArchive] =
    useAgentStore((s) => [
      agentChatConfigSelectors.historyCount(s),
      agentChatConfigSelectors.enableHistoryCount(s),
      agentChatConfigSelectors.currentChatConfig(s).enableCompressHistory,
      agentChatConfigSelectors.currentChatConfig(s).enableUserMemoryArchive,
    ]);

  const maxTokens = useModelContextWindowTokens(model, provider);
  const canUseTool = useModelSupportToolUse(model, provider);
  const pluginIds = useAgentStore(agentSelectors.currentAgentPlugins);
  const generalInstruction = useUserStore(userGeneralSettingsSelectors.generalInstruction);
  const composedSystemRole = composeSystemRole(generalInstruction, systemRole);

  const isGroupSession = useChatStore((s) => s.activeSessionType === 'group');

  const toolsString = useToolStore((s) => {
    const toolsEngine = createChatToolsEngine(
      { model, provider },
      { enableMemoryTool: enableAssistantMemory && !isGroupSession },
    );
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
  const messageFingerprint = useChatStore((state) => {
    const chats =
      conversationSource === 'portal'
        ? threadSelectors.portalAIChats(state)
        : chatSelectors.mainAIChats(state);

    return chats.map((chat) => `${chat.id}\u0000${chat.content}`).join('\u0001');
  });

  const chatsString = useMemo(() => {
    const state = useChatStore.getState();
    const chats =
      conversationSource === 'portal'
        ? threadSelectors.portalAIChats(state)
        : chatSelectors.mainAIChats(state);
    const chatsWithHistoryConfig = selectMessagesForContext({
      cursorId:
        conversationSource === 'main' &&
        enableHistoryCount &&
        enableCompressHistory &&
        isRegularTopic
          ? historySummaryLastMessageId
          : undefined,
      enableHistoryCount,
      historyCount,
      messages: chats,
    });

    return chatsWithHistoryConfig.map((chat) => chat.content).join('');
  }, [
    conversationSource,
    enableCompressHistory,
    enableHistoryCount,
    historyCount,
    historySummaryLastMessageId,
    isRegularTopic,
    messageFingerprint,
  ]);

  const chatsToken = useTokenCount(chatsString) + inputTokenCount;
  const systemRoleToken = useTokenCount(composedSystemRole);
  const chatInstructionToken = useTokenCount(generalInstruction?.trim());
  const roleSettingsToken = Math.max(0, systemRoleToken - chatInstructionToken);
  const memorySummary = useMemo(
    () =>
      buildHistorySummaryForRequest({
        archives: memoryArchives,
        enableCompressHistory:
          conversationSource === 'main' &&
          enableCompressHistory &&
          enableHistoryCount &&
          isRegularTopic,
        enableUserMemoryArchive,
        topicSummary: historySummary,
      }) || '',
    [
      enableCompressHistory,
      enableHistoryCount,
      enableUserMemoryArchive,
      historySummary,
      isRegularTopic,
      memoryArchives,
      conversationSource,
    ],
  );
  // mirrors the AgentMemoryProvider injection built in internal_fetchAIChatMessage
  const agentMemoryBlock = useMemo(
    () =>
      enableAssistantMemory
        ? agentMemoryPrompt({
            dynamicMemory: normalizeAssistantMemoryText(assistantMemory) || undefined,
            fixedMemory: fixedMemory.trim() || undefined,
          })
        : '',
    [assistantMemory, fixedMemory, enableAssistantMemory],
  );
  const memoryToken = useTokenCount(agentMemoryBlock);
  const historySummaryToken = useTokenCount(memorySummary);
  const totalToken = systemRoleToken + memoryToken + historySummaryToken + toolsToken + chatsToken;
  const ratio = maxTokens > 0 ? totalToken / maxTokens : 0;

  return {
    chatInstructionToken,
    chatsToken,
    historySummaryToken,
    inputTokenCount,
    maxTokens,
    memoryToken,
    ratio,
    roleSettingsToken,
    systemRoleToken,
    toolsToken,
    totalToken,
  };
};
