import { formatSkillInstructionsBlock } from '@lobechat/context-engine';
import { agentMemoryPrompt } from '@lobechat/prompts';
import { useEffect, useMemo, useState } from 'react';

import { normalizeAssistantMemoryText } from '@/helpers/assistantMemory';
import { selectMessagesForContext } from '@/helpers/contextCompaction';
import {
  estimateFixedContextOverheadTokens,
  getHistoryWindowDiagnostics,
  serializeMessagesForContextEstimate,
  wrapHistorySummaryForTokenEstimate,
} from '@/helpers/contextUsageEstimate';
import type { HistoryWindowDiagnostics } from '@/helpers/contextUsageEstimate';
import { buildHistorySummaryForRequest } from '@/helpers/memoryArchivePrompt';
import { createChatToolsEngine } from '@/helpers/toolEngineering';
import { useModelContextWindowTokens } from '@/hooks/useModelContextWindowTokens';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useTokenCount } from '@/hooks/useTokenCount';
import { composeSystemRole } from '@/services/chat/composeSystemRole';
import { skillService } from '@/services/skill';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatSelectors, threadSelectors, topicSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getSkillSelectionKey, skillSelectors, useSkillStore } from '@/store/skill';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

export interface EstimatedContextUsage {
  chatInstructionToken: number;
  chatsToken: number;
  historySummaryToken: number;
  historyWindow: HistoryWindowDiagnostics;
  inputTokenCount: number;
  knowledgeBaseToken: number;
  lastCompactionStatus?: string;
  maxTokens: number;
  memoryToken: number;
  ratio: number;
  roleSettingsToken: number;
  systemRoleToken: number;
  toolsToken: number;
  /** Content estimate of all topic messages (growth signal; not on the wire). */
  topicChatsToken: number;
  totalToken: number;
}

export type EstimatedContextConversationSource = 'main' | 'portal';

/** Same token accounting as the chat input token popover (debounced via useTokenCount). */
export const useEstimatedContextUsage = (
  conversationSource: EstimatedContextConversationSource = 'main',
): EstimatedContextUsage => {
  const [
    input,
    historySummary,
    memoryArchives,
    historySummaryLastMessageId,
    isRegularTopic,
    lastCompactionStatus,
    skillSelectionKey,
  ] = useChatStore((s) => [
    s.inputMessage,
    topicSelectors.currentActiveTopicSummary(s)?.content,
    topicSelectors.currentActiveTopic(s)?.metadata?.memoryArchives,
    topicSelectors.currentActiveTopic(s)?.metadata?.historySummaryLastMessageId,
    s.activeSessionType !== 'group' && !s.activeThreadId && !s.portalThreadId,
    topicSelectors.currentActiveTopic(s)?.metadata?.memoryDebugLog?.at(-1)?.status,
    getSkillSelectionKey({
      sessionId: s.activeId,
      threadId: s.activeThreadId,
      topicId: s.activeTopicId,
    }),
  ]);
  const selectedSkillIds = useSkillStore(skillSelectors.selectedSkillIds(skillSelectionKey));
  const selectedSkillIdKey = selectedSkillIds.join(',');
  const [skillInstructions, setSkillInstructions] = useState('');

  useEffect(() => {
    if (!selectedSkillIdKey) {
      setSkillInstructions('');
      return;
    }

    let cancelled = false;
    void skillService.resolveSkills(selectedSkillIdKey.split(',')).then((records) => {
      if (cancelled) return;
      setSkillInstructions(
        formatSkillInstructionsBlock({
          activated: records.map((skill) => ({
            description: skill.description,
            identifier: skill.identifier,
            instructions: skill.instructions,
            name: skill.name,
          })),
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [selectedSkillIdKey]);

  const [systemRole, model, provider, assistantMemory, fixedMemory, enableAssistantMemory] =
    useAgentStore((s) => [
      agentSelectors.currentAgentSystemRole(s),
      agentSelectors.currentAgentModel(s) as string,
      agentSelectors.currentAgentModelProvider(s) as string,
      agentSelectors.currentAgentConfig(s).assistantMemory ?? '',
      agentSelectors.currentAgentConfig(s).fixedMemory ?? '',
      agentChatConfigSelectors.enableAssistantMemory(s),
    ]);

  const [
    historyCount,
    enableHistoryCount,
    enableCompressHistory,
    enableUserMemoryArchive,
    inputTemplate,
  ] = useAgentStore((s) => [
    agentChatConfigSelectors.historyCount(s),
    agentChatConfigSelectors.enableHistoryCount(s),
    agentChatConfigSelectors.currentChatConfig(s).enableCompressHistory,
    agentChatConfigSelectors.enableUserMemoryArchive(s),
    agentChatConfigSelectors.currentChatConfig(s).inputTemplate,
  ]);

  const maxTokens = useModelContextWindowTokens(model, provider);
  const knowledgeBaseToken = useChatStore((state) =>
    state.activeId
      ? (state.knowledgeBaseContextTokens[messageMapKey(state.activeId, state.activeTopicId)] ?? 0)
      : 0,
  );
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

    return chats
      .map(
        (chat) =>
          `${chat.id}\u0000${chat.role}\u0000${chat.content}\u0000${chat.tool_call_id ?? ''}\u0000${JSON.stringify(chat.tools ?? [])}`,
      )
      .join('\u0001');
  });

  const memorySummaryRaw = useMemo(
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
  const memorySummaryWrapped = useMemo(
    () => wrapHistorySummaryForTokenEstimate(memorySummaryRaw),
    [memorySummaryRaw],
  );

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
  const historySummaryToken = useTokenCount(memorySummaryWrapped);
  const systemRoleToken = useTokenCount(composedSystemRole);
  const skillToken = useTokenCount(skillInstructions);
  const chatInstructionToken = useTokenCount(generalInstruction?.trim());
  const roleSettingsToken = Math.max(0, systemRoleToken - chatInstructionToken);

  const fixedOverheadTokens =
    estimateFixedContextOverheadTokens({
      agentMemory: agentMemoryBlock,
      historySummaryRaw: memorySummaryRaw,
      skillInstructions,
      systemRole: composedSystemRole,
      toolsString: canUseTool ? toolsString : '',
    }) + knowledgeBaseToken;

  const { chatsString, topicChatsString, historyWindow } = useMemo(() => {
    const state = useChatStore.getState();
    const chats =
      conversationSource === 'portal'
        ? threadSelectors.portalAIChats(state)
        : chatSelectors.mainAIChats(state);

    const applyCursor =
      conversationSource === 'main' && enableHistoryCount && enableCompressHistory && isRegularTopic;
    const cursorId = applyCursor ? historySummaryLastMessageId : undefined;
    const sliced = selectMessagesForContext({
      cursorId,
      enableHistoryCount,
      fixedOverheadTokens,
      historyCount,
      inputTemplate,
      maxTokens,
      messages: chats,
    });

    return {
      chatsString: serializeMessagesForContextEstimate(sliced, inputTemplate),
      historyWindow: getHistoryWindowDiagnostics({
        configuredHistoryCount: historyCount,
        cursorId,
        enableCompressHistory: applyCursor,
        enableHistoryCount,
        fixedOverheadTokens,
        hasTopicSummary: !!memorySummaryRaw.trim(),
        historyCount,
        inputTemplate,
        maxTokens,
        messages: chats,
      }),
      topicChatsString: serializeMessagesForContextEstimate(chats, inputTemplate),
    };
  }, [
    conversationSource,
    enableCompressHistory,
    enableHistoryCount,
    fixedOverheadTokens,
    historyCount,
    historySummaryLastMessageId,
    inputTemplate,
    isRegularTopic,
    maxTokens,
    memorySummaryRaw,
    messageFingerprint,
  ]);

  const chatsToken = useTokenCount(chatsString) + inputTokenCount;
  const topicChatsToken = useTokenCount(topicChatsString);
  const totalToken =
    systemRoleToken +
    memoryToken +
    historySummaryToken +
    toolsToken +
    chatsToken +
    knowledgeBaseToken +
    skillToken;
  const ratio = maxTokens > 0 ? totalToken / maxTokens : 0;

  return {
    chatInstructionToken,
    chatsToken,
    historySummaryToken,
    historyWindow,
    inputTokenCount,
    knowledgeBaseToken,
    lastCompactionStatus,
    maxTokens,
    memoryToken,
    ratio,
    roleSettingsToken,
    systemRoleToken,
    toolsToken,
    topicChatsToken,
    totalToken,
  };
};
