import { applyUserInputTemplate, formatSkillInstructionsBlock } from '@lobechat/context-engine';
import { agentMemoryPrompt } from '@lobechat/prompts';

import { getModelContextWindowTokens } from '@/helpers/modelContextWindowTokens';
import { createChatToolsEngine } from '@/helpers/toolEngineering';
import { composeSystemRole } from '@/services/chat/composeSystemRole';
import { skillService } from '@/services/skill';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { ChatStoreState } from '@/store/chat/initialState';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';
import { getSkillSelectionKey, getSkillStoreState, skillSelectors } from '@/store/skill';
import { toolSelectors } from '@/store/tool/selectors';
import { getToolStoreState } from '@/store/tool/store';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';
import { encodeAsync } from '@/utils/tokenizer';
import { fileChatSelectors } from '@/store/file/slices/chat/selectors';
import { getFileStoreState } from '@/store/file/store';

import { normalizeAssistantMemoryText } from './assistantMemory';
import {
  PENDING_CONTEXT_INPUT_MESSAGE_ID,
  appendPendingUserInputForContextWindow,
  getMessagesAfterHistorySummaryCursor,
  resolveEffectiveHistoryWindow,
  selectMessagesForContext,
} from './contextCompaction';
import {
  estimateFixedContextOverheadTokens,
  resolveEffectiveHistoryCountForCompaction,
  serializeMessagesForContextEstimate,
  wrapHistorySummaryForTokenEstimate,
} from './contextUsageEstimate';
import { buildHistorySummaryForRequest } from './memoryArchivePrompt';
import {
  applyReportedInputTokenFloor,
  getEffectiveReportedInputTokenFloorAfterMessageId,
  getLatestReportedInputAnchor,
  getLatestReportedInputTokens,
} from './reportedContextTokens';

interface EstimateContextUsageOverrides {
  historySummary?: string;
  historySummaryLastMessageId?: string | null;
  memoryArchives?: NonNullable<
    ReturnType<typeof topicSelectors.currentActiveTopic>
  >['metadata']['memoryArchives'];
  reportedInputTokenFloorAfterMessageId?: string | null;
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
  /** HistoryTruncate window setting (not included-row count after continuations). */
  effectiveHistoryCount: number;
  historySummaryToken: number;
  includedMessageCount: number;
  inputToken: number;
  memoryToken: number;
  systemRoleToken: number;
  toolsToken: number;
  totalToken: number;
}> => {
  const input = chatState.inputMessage || '';
  const pendingHasFiles = fileChatSelectors.chatUploadFileListHasItem(getFileStoreState());
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
  const reportedInputTokenFloorAfterMessageId =
    overrides?.reportedInputTokenFloorAfterMessageId === undefined
      ? activeTopic?.metadata?.reportedInputTokenFloorAfterMessageId
      : overrides.reportedInputTokenFloorAfterMessageId || undefined;
  const agentConfig = agentSelectors.currentAgentConfig(agentState);
  const chatConfig = agentChatConfigSelectors.currentChatConfig(agentState);
  const enableHistoryCount = agentChatConfigSelectors.enableHistoryCount(agentState);
  const configuredHistoryCount = agentChatConfigSelectors.historyCount(agentState);
  const enableHistoryCompaction = !!enableHistoryCount && !!chatConfig.enableCompressHistory;
  const historySummaryForRequest =
    buildHistorySummaryForRequest({
      archives: memoryArchives,
      enableCompressHistory: enableHistoryCompaction,
      enableUserMemoryArchive: chatConfig.enableUserMemoryArchive,
      topicSummary: historySummary,
    }) || '';
  const historySummaryWrapped = wrapHistorySummaryForTokenEstimate(historySummaryForRequest);
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
  const maxTokens = getModelContextWindowTokens(model, provider);

  const aiState = getAiInfraStoreState();
  const canUseTool = aiModelSelectors.isModelSupportToolUse(model, provider)(aiState);
  const pluginIds = agentSelectors.currentAgentPlugins(agentState);

  const toolState = getToolStoreState();
  const toolsEngine = createChatToolsEngine(
    { model, provider },
    {
      enableMemoryTool:
        agentChatConfigSelectors.enableAssistantMemory(agentState) &&
        chatState.activeSessionType !== 'group',
    },
  );
  const { tools, enabledToolIds } = toolsEngine.generateToolsDetailed({
    model,
    provider,
    toolIds: pluginIds,
  });
  const schemaNumber = tools?.map((i) => JSON.stringify(i)).join('') || '';
  const pluginSystemRoles = toolSelectors.enabledSystemRoles(enabledToolIds)(toolState);
  const toolsString = canUseTool ? pluginSystemRoles + schemaNumber : '';
  const inputTemplate = chatConfig.inputTemplate?.trim() || '';
  const skillIds = skillSelectors.selectedSkillIds(
    getSkillSelectionKey({
      sessionId: chatState.activeId,
      threadId: chatState.activeThreadId,
      topicId: chatState.activeTopicId,
    }),
  )(getSkillStoreState());
  const skillRecords = skillIds.length ? await skillService.resolveSkills(skillIds) : [];
  const skillInstructions = formatSkillInstructionsBlock({
    activated: skillRecords.map((skill) => ({
      description: skill.description,
      identifier: skill.identifier,
      instructions: skill.instructions,
      name: skill.name,
    })),
  });

  const templatedInput = applyUserInputTemplate(inputTemplate, input);
  const [systemRoleToken, memoryToken, historySummaryToken, toolsToken, inputToken, skillToken] =
    await Promise.all(
      [
        systemRole || '',
        agentMemoryForRequest,
        historySummaryWrapped,
        toolsString,
        templatedInput,
        skillInstructions,
      ].map((value) => countTokens(value || '')),
    );

  const fixedOverheadTokens = estimateFixedContextOverheadTokens({
    agentMemory: agentMemoryForRequest,
    historySummaryRaw: historySummaryForRequest,
    skillInstructions,
    systemRole,
    toolsString,
  });

  const rawMessages = chatSelectors.mainAIChats(chatState);
  const afterCursor = getMessagesAfterHistorySummaryCursor(
    appendPendingUserInputForContextWindow(rawMessages, input, pendingHasFiles),
    enableHistoryCompaction ? historySummaryLastMessageId : undefined,
  );
  const effective = resolveEffectiveHistoryWindow({
    enableHistoryCount,
    fixedOverheadTokens,
    historyCount: configuredHistoryCount,
    inputTemplate,
    maxTokens,
    messagesAfterCursor: afterCursor,
  });
  const chats = selectMessagesForContext({
    cursorId: enableHistoryCompaction ? historySummaryLastMessageId : undefined,
    enableHistoryCount,
    fixedOverheadTokens,
    historyCount: configuredHistoryCount,
    inputTemplate,
    maxTokens,
    messages: rawMessages,
    pendingHasFiles,
    pendingInput: input,
  });
  const estimateMessages = chats.filter(({ id }) => id !== PENDING_CONTEXT_INPUT_MESSAGE_ID);
  const floorAfterMessageId = getEffectiveReportedInputTokenFloorAfterMessageId({
    cursorId: enableHistoryCompaction ? historySummaryLastMessageId : undefined,
    messages: estimateMessages,
    storedAfterMessageId: reportedInputTokenFloorAfterMessageId,
    topicMessages: rawMessages,
  });
  const usageLookupOptions = floorAfterMessageId
    ? { afterMessageId: floorAfterMessageId, lookupMessages: rawMessages }
    : undefined;
  const fixedTokens =
    systemRoleToken + memoryToken + historySummaryToken + toolsToken + skillToken;

  // C2 usage anchor: the newest post-watermark assistant's provider-reported
  // totalInputTokens exactly covers fixed overhead plus history up to that
  // request, so only the tail (the anchor's own reply and later messages,
  // including the pending input row) needs tokenizing. This replaces the
  // whole-window tokenizer estimate, which undercounts CJK ~3x. Without an
  // anchor, fall back to the whole-window estimate floored by reported usage.
  const anchor = getLatestReportedInputAnchor(estimateMessages, usageLookupOptions);

  let chatsToken: number;
  let totalToken: number;
  if (anchor) {
    const anchorIndex = chats.findIndex(({ id }) => id === anchor.id);
    const tailToken = await countTokens(
      serializeMessagesForContextEstimate(chats.slice(Math.max(0, anchorIndex)), inputTemplate),
    );
    totalToken = anchor.totalInputTokens + tailToken;
    chatsToken = Math.max(0, totalToken - fixedTokens);
  } else {
    const wholeWindowToken = await countTokens(
      serializeMessagesForContextEstimate(chats, inputTemplate),
    );
    const reportedInput = getLatestReportedInputTokens(estimateMessages, usageLookupOptions);
    const floor = applyReportedInputTokenFloor(fixedTokens + wholeWindowToken, reportedInput);
    chatsToken = wholeWindowToken + floor.chatsTokenDelta;
    totalToken = floor.totalToken;
  }

  return {
    chatsToken,
    contextMessages: chats.filter(({ id }) => id !== PENDING_CONTEXT_INPUT_MESSAGE_ID),
    effectiveHistoryCount: resolveEffectiveHistoryCountForCompaction(
      effective,
      afterCursor.length,
    ),
    historySummaryToken,
    includedMessageCount: chats.length,
    inputToken,
    memoryToken,
    systemRoleToken,
    toolsToken,
    totalToken,
  };
};
