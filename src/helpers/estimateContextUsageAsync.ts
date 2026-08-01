import { agentMemoryPrompt } from '@lobechat/prompts';

import { createChatToolsEngine } from '@/helpers/toolEngineering';
import { composeSystemRole } from '@/services/chat/composeSystemRole';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { ChatStoreState } from '@/store/chat/initialState';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';
import { toolSelectors } from '@/store/tool/selectors';
import { getToolStoreState } from '@/store/tool/store';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';
import { encodeAsync } from '@/utils/tokenizer';

import { normalizeAssistantMemoryText } from './assistantMemory';
import { selectMessagesForContext } from './contextCompaction';
import { buildHistorySummaryForRequest } from './memoryArchivePrompt';

interface EstimateContextUsageOverrides {
  historySummary?: string;
  historySummaryLastMessageId?: string | null;
  memoryArchives?: NonNullable<
    ReturnType<typeof topicSelectors.currentActiveTopic>
  >['metadata']['memoryArchives'];
}

export interface EstimateContextUsageAsyncParams {
  agentState: ReturnType<typeof getAgentStoreState>;
  chatState: ChatStoreState;
  overrides?: EstimateContextUsageOverrides;
}

const countTokens = async (value: string) => {
  try {
    return await encodeAsync(value);
  } catch {
    return value.length;
  }
};

/** Non-debounced estimate for automation (token threshold, compaction metadata). */
export const estimateContextUsageAsync = async ({
  agentState,
  chatState,
  overrides,
}: EstimateContextUsageAsyncParams): Promise<{
  chatsToken: number;
  contextMessages: ReturnType<typeof chatSelectors.mainAIChats>;
  historySummaryToken: number;
  memoryToken: number;
  totalToken: number;
}> => {
  const input = chatState.inputMessage || '';
  const activeTopic = topicSelectors.currentActiveTopic(chatState);
  const historySummary = overrides
    ? overrides.historySummary
    : topicSelectors.currentActiveTopicSummary(chatState)?.content;
  const historySummaryLastMessageId =
    overrides?.historySummaryLastMessageId === undefined
      ? activeTopic?.metadata?.historySummaryLastMessageId
      : overrides.historySummaryLastMessageId || undefined;
  const memoryArchives = overrides
    ? overrides.memoryArchives
    : activeTopic?.metadata?.memoryArchives;
  const agentConfig = agentSelectors.currentAgentConfig(agentState);
  const chatConfig = agentChatConfigSelectors.currentChatConfig(agentState);
  const enableHistoryCount = agentChatConfigSelectors.enableHistoryCount(agentState);
  const enableHistoryCompaction = !!enableHistoryCount && !!chatConfig.enableCompressHistory;
  const historySummaryForRequest =
    buildHistorySummaryForRequest({
      archives: memoryArchives,
      enableCompressHistory: enableHistoryCompaction,
      enableUserMemoryArchive: chatConfig.enableUserMemoryArchive,
      topicSummary: historySummary,
    }) || '';
  // mirrors the AgentMemoryProvider injection built in internal_fetchAIChatMessage
  const agentMemoryForRequest = agentChatConfigSelectors.enableAssistantMemory(agentState)
    ? agentMemoryPrompt({
        dynamicMemory: normalizeAssistantMemoryText(agentConfig.assistantMemory) || undefined,
        fixedMemory: (agentConfig.fixedMemory ?? '').trim() || undefined,
      })
    : '';

  const generalInstruction = userGeneralSettingsSelectors.generalInstruction(getUserStoreState());
  const systemRole = composeSystemRole(
    generalInstruction,
    agentSelectors.currentAgentSystemRole(agentState),
  );
  const model = agentSelectors.currentAgentModel(agentState) as string;
  const provider = agentSelectors.currentAgentModelProvider(agentState) as string;

  const aiState = getAiInfraStoreState();
  const canUseTool = aiModelSelectors.isModelSupportToolUse(model, provider)(aiState);
  const pluginIds = agentSelectors.currentAgentPlugins(agentState);

  const toolState = getToolStoreState();
  const toolsEngine = createChatToolsEngine({ model, provider });
  const { tools, enabledToolIds } = toolsEngine.generateToolsDetailed({
    model,
    provider,
    toolIds: pluginIds,
  });
  const schemaNumber = tools?.map((i) => JSON.stringify(i)).join('') || '';
  const pluginSystemRoles = toolSelectors.enabledSystemRoles(enabledToolIds)(toolState);
  const toolsString = canUseTool ? pluginSystemRoles + schemaNumber : '';

  const chats = selectMessagesForContext({
    cursorId: enableHistoryCompaction ? historySummaryLastMessageId : undefined,
    enableHistoryCount,
    historyCount: agentChatConfigSelectors.historyCount(agentState),
    messages: chatSelectors.mainAIChats(chatState),
  });
  const chatsString = chats.map((chat) => chat.content).join('');

  const [systemRoleToken, memoryToken, historySummaryToken, toolsToken, chatsToken, inputToken] =
    await Promise.all(
      [
        systemRole,
        agentMemoryForRequest,
        historySummaryForRequest,
        toolsString,
        chatsString,
        input,
      ].map((value) => countTokens(value || '')),
    );

  return {
    chatsToken,
    contextMessages: chats,
    historySummaryToken,
    memoryToken,
    totalToken:
      systemRoleToken + memoryToken + historySummaryToken + toolsToken + chatsToken + inputToken,
  };
};
