import { createChatToolsEngine } from '@/helpers/toolEngineering';
import { getAgentStoreState } from '@/store/agent/store';
import { agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { ChatStoreState } from '@/store/chat/initialState';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';
import { getToolStoreState } from '@/store/tool/store';
import { toolSelectors } from '@/store/tool/selectors';
import { encodeAsync } from '@/utils/tokenizer';

export interface EstimateContextUsageAsyncParams {
  agentState: ReturnType<typeof getAgentStoreState>;
  chatState: ChatStoreState;
}

/** Non-debounced estimate for automation (token threshold, compaction metadata). */
export const estimateContextUsageAsync = async ({
  agentState,
  chatState,
}: EstimateContextUsageAsyncParams): Promise<{ totalToken: number }> => {
  const input = chatState.inputMessage || '';
  const historySummary = topicSelectors.currentActiveTopicSummary(chatState)?.content || '';
  const assistantMemory = (agentSelectors.currentAgentConfig(agentState).assistantMemory ?? '').trim();

  const systemRole = agentSelectors.currentAgentSystemRole(agentState);
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

  const chats = chatSelectors.mainAIChatsWithHistoryConfig(chatState);
  const chatsString = chats.map((chat) => chat.content).join('');

  const parts = [systemRole, assistantMemory, historySummary, toolsString, chatsString, input].map(
    (s) => s || '',
  );
  let total = 0;
  for (const p of parts) {
    try {
      total += await encodeAsync(p);
    } catch {
      total += p.length;
    }
  }

  return { totalToken: total };
};
