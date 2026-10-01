import { applyUserInputTemplate, formatSkillInstructionsBlock } from '@lobechat/context-engine';
import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_MODEL, DEFAULT_PROVIDER } from '@lobechat/const';
import { agentMemoryPrompt } from '@lobechat/prompts';
import { ChatTopicMetadata, LobeAgentConfig } from '@lobechat/types';

import { countMessagesContextTokens, messageTextForTokenCount } from '@/helpers/contextMessageTokens';
import { countContextTextTokens, warmContextTokenCache } from '@/helpers/contextTokenCount';
import { fixedContextOverheadText } from '@/helpers/contextUsageEstimate';
import { resolveInputBudgetTokens } from '@/helpers/inputBudget';
import { getModelContextWindowTokens } from '@/helpers/modelContextWindowTokens';
import { scaleLocalTokens } from '@/helpers/tokenCalibration';
import { createChatToolsEngine } from '@/helpers/toolEngineering';
import { composeSystemRole } from '@/services/chat/composeSystemRole';
import { skillService } from '@/services/skill';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { ChatStoreState } from '@/store/chat/initialState';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getSkillSelectionKey, getSkillStoreState, skillSelectors } from '@/store/skill';
import { toolSelectors } from '@/store/tool/selectors';
import { getToolStoreState } from '@/store/tool/store';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';
import { fileChatSelectors } from '@/store/file/slices/chat/selectors';
import { getFileStoreState } from '@/store/file/store';

import { normalizeAssistantMemoryText } from './assistantMemory';
import {
  PENDING_CONTEXT_INPUT_MESSAGE_ID,
  appendPendingUserInputForContextWindow,
  getListedModelMaxOutputTokens,
  type MessageLikeForHistoryWindow,
  getMessagesAfterHistorySummaryCursor,
  resolveEffectiveHistoryWindow,
  selectMessagesForContext,
} from './contextCompaction';
import {
  estimateFixedContextOverheadTokens,
  resolveEffectiveHistoryCountForCompaction,
  wrapHistorySummaryForTokenEstimate,
} from './contextUsageEstimate';
import { buildHistorySummaryForRequest } from './memoryArchivePrompt';
import {
  applyReportedInputTokenFloor,
  fingerprintAnchorPrefix,
  getEffectiveReportedInputTokenFloorAfterMessageId,
  getLatestReportedInputAnchor,
  getLatestReportedInputTokens,
  resolveAnchorBaseline,
  resolveSelectedPreAnchorIds,
} from './reportedContextTokens';

interface EstimateContextUsageOverrides {
  historySummary?: string;
  historySummaryLastMessageId?: string | null;
  memoryArchives?: ChatTopicMetadata['memoryArchives'];
  reportedInputTokenFloorAfterMessageId?: string | null;
}

export interface EstimateContextUsageAsyncParams {
  agentState: ReturnType<typeof getAgentStoreState>;
  chatState: ChatStoreState;
  /** Per-model correction. Applied only to locally counted tokens. */
  multiplier?: number;
  overrides?: EstimateContextUsageOverrides;
}

const countTokens = async (value: string) => (await countContextTextTokens(value)).count;

export interface FixedContextOverheadInput {
  agentMemory: string;
  /** Tokenizer-unit fixed overhead via `estimateFixedContextOverheadTokens`. */
  fixedOverheadTokens: number;
  historySummaryRaw: string;
  skillInstructions: string;
  systemRole: string;
  toolsString: string;
}

/**
 * Assemble the fixed-overhead inputs for ONE conversation — composed system
 * role, agent memory block, history summary, tool schemas/system roles and
 * activated-skill instructions — plus the shared-unit estimate. Both the
 * estimator (active conversation) and the send path's dispatch witness call
 * this, so the anchor baseline and the current estimate can never drift into
 * different overhead assemblies (R4) and a witness always reflects the
 * dispatched request's own conversation (T1 round 5).
 *
 * `agentConfig` must be the default-merged config of the CONVERSATION's agent
 * (`agentSelectors.getAgentConfigById(sessionId)` /
 * `resolveConversationAgentRuntime`), not necessarily the visible active one.
 */
export const computeFixedContextOverheadInput = async ({
  agentConfig,
  chatState,
  enableHistoryCount,
  isGroupSession,
  sessionId,
  threadId,
  skipSkills,
  topicId,
  topicOverride,
}: {
  agentConfig: LobeAgentConfig;
  chatState: ChatStoreState;
  enableHistoryCount: boolean;
  isGroupSession: boolean;
  sessionId: string;
  /** Skip the tRPC skill resolve. Dispatch witnesses must never block send. */
  skipSkills?: boolean;
  threadId?: string | null;
  topicId?: string | null;
  /** Post-compaction what-if estimates pass explicit topic state. */
  topicOverride?: {
    historySummary?: string;
    memoryArchives?: ChatTopicMetadata['memoryArchives'];
  };
}): Promise<FixedContextOverheadInput> => {
  const chatConfig = agentConfig.chatConfig || {};
  const topic = topicId ? topicSelectors.getTopicInContainer(sessionId, topicId)(chatState) : undefined;
  const historySummary = topicOverride ? topicOverride.historySummary : topic?.historySummary;
  const memoryArchives = topicOverride ? topicOverride.memoryArchives : topic?.metadata?.memoryArchives;
  const historySummaryRaw =
    buildHistorySummaryForRequest({
      archives: memoryArchives,
      enableCompressHistory: !!enableHistoryCount && !!chatConfig.enableCompressHistory,
      enableUserMemoryArchive: chatConfig.enableUserMemoryArchive,
      topicSummary: historySummary,
    }) || '';
  const enableAssistantMemory =
    chatConfig.enableAssistantMemory ?? DEFAULT_AGENT_CHAT_CONFIG.enableAssistantMemory!;
  const agentMemory = enableAssistantMemory
    ? agentMemoryPrompt({
        dynamicMemory: normalizeAssistantMemoryText(agentConfig.assistantMemory) || undefined,
        fixedMemory: (agentConfig.fixedMemory ?? '').trim() || undefined,
      })
    : '';
  const generalInstruction = userGeneralSettingsSelectors.generalInstruction(getUserStoreState());
  const systemRole = composeSystemRole(generalInstruction, agentConfig.systemRole);
  const model = agentConfig.model || DEFAULT_MODEL;
  const provider = agentConfig.provider || DEFAULT_PROVIDER;
  const canUseTool = aiModelSelectors.isModelSupportToolUse(model, provider)(
    getAiInfraStoreState(),
  );
  const toolsEngine = createChatToolsEngine(
    { model, provider },
    { enableMemoryTool: enableAssistantMemory && !isGroupSession },
  );
  const { tools, enabledToolIds } = toolsEngine.generateToolsDetailed({
    model,
    provider,
    toolIds: agentConfig.plugins || [],
  });
  const schemaNumber = tools?.map((i) => JSON.stringify(i)).join('') || '';
  const pluginSystemRoles = toolSelectors.enabledSystemRoles(enabledToolIds)(getToolStoreState());
  const toolsString = canUseTool ? pluginSystemRoles + schemaNumber : '';
  const skillIds = skillSelectors.selectedSkillIds(
    getSkillSelectionKey({
      sessionId,
      threadId,
      topicId,
    }),
  )(getSkillStoreState());
  const skillRecords =
    !skipSkills && skillIds.length ? await skillService.resolveSkills(skillIds) : [];
  const skillInstructions = formatSkillInstructionsBlock({
    activated: skillRecords.map((skill) => ({
      description: skill.description,
      identifier: skill.identifier,
      instructions: skill.instructions,
      name: skill.name,
    })),
  });

  const overheadText = fixedContextOverheadText({
    agentMemory,
    historySummaryRaw,
    skillInstructions,
    systemRole,
    toolsString,
  });
  await warmContextTokenCache([overheadText]);

  return {
    agentMemory,
    fixedOverheadTokens: estimateFixedContextOverheadTokens({
      agentMemory,
      historySummaryRaw,
      skillInstructions,
      systemRole,
      toolsString,
    }),
    historySummaryRaw,
    skillInstructions,
    systemRole: systemRole ?? '',
    toolsString,
  };
};

/** Non-debounced estimate for automation (token threshold, compaction metadata). */
export const estimateContextUsageAsync = async ({
  agentState,
  chatState,
  multiplier = 1,
  overrides,
}: EstimateContextUsageAsyncParams): Promise<{
  chatsToken: number;
  contextMessages: ReturnType<typeof chatSelectors.mainAIChats>;
  /** HistoryTruncate window setting (not included-row count after continuations). */
  effectiveHistoryCount: number;
  historySummaryToken: number;
  imageTokens: number;
  includedMessageCount: number;
  inputBudget: number;
  inputToken: number;
  memoryToken: number;
  multiplier: number;
  reservedOutput: number;
  systemRoleToken: number;
  tokenEstimateEligible: boolean;
  toolsToken: number;
  totalToken: number;
  uncalibratedTokens: number;
}> => {
  const input = chatState.inputMessage || '';
  const pendingHasFiles = fileChatSelectors.chatUploadFileListHasItem(getFileStoreState());
  const activeTopic = topicSelectors.currentActiveTopic(chatState);
  const historySummaryLastMessageId =
    overrides?.historySummaryLastMessageId === undefined
      ? activeTopic?.metadata?.historySummaryLastMessageId
      : overrides.historySummaryLastMessageId || undefined;
  const reportedInputTokenFloorAfterMessageId =
    overrides?.reportedInputTokenFloorAfterMessageId === undefined
      ? activeTopic?.metadata?.reportedInputTokenFloorAfterMessageId
      : overrides.reportedInputTokenFloorAfterMessageId || undefined;
  const agentConfig = agentSelectors.currentAgentConfig(agentState);
  const chatConfig = agentChatConfigSelectors.currentChatConfig(agentState);
  const enableHistoryCount = agentChatConfigSelectors.enableHistoryCount(agentState);
  const configuredHistoryCount = agentChatConfigSelectors.historyCount(agentState);
  const enableHistoryCompaction = !!enableHistoryCount && !!chatConfig.enableCompressHistory;
  // The overhead assembly is shared with the send path's dispatch witness so
  // the anchor delta can never drift between call sites (R4/T1).
  const {
    agentMemory: agentMemoryForRequest,
    fixedOverheadTokens,
    historySummaryRaw: historySummaryForRequest,
    skillInstructions,
    systemRole,
    toolsString,
  } = await computeFixedContextOverheadInput({
    agentConfig,
    chatState,
    enableHistoryCount: !!enableHistoryCount,
    isGroupSession: chatState.activeSessionType === 'group',
    sessionId: chatState.activeId,
    threadId: chatState.activeThreadId,
    topicId: chatState.activeTopicId,
    topicOverride: overrides
      ? { historySummary: overrides.historySummary, memoryArchives: overrides.memoryArchives }
      : undefined,
  });
  const historySummaryWrapped = wrapHistorySummaryForTokenEstimate(historySummaryForRequest);
  const model = agentSelectors.currentAgentModel(agentState) as string;
  const provider = agentSelectors.currentAgentModelProvider(agentState) as string;
  const maxTokens = getModelContextWindowTokens(model, provider);
  const requestedMaxTokens = agentConfig.params?.max_tokens;
  const inputBudget = resolveInputBudgetTokens({
    contextWindowTokens: maxTokens,
    maxOutput: getListedModelMaxOutputTokens(model, provider),
    maxTokens: typeof requestedMaxTokens === 'number' ? requestedMaxTokens : undefined,
  });
  const reservedOutput = Math.max(0, (maxTokens || 0) - inputBudget);
  const inputTemplate = chatConfig.inputTemplate?.trim() || '';

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

  const rawMessages = chatSelectors.mainAIChats(chatState);
  const afterCursor = getMessagesAfterHistorySummaryCursor(
    appendPendingUserInputForContextWindow(rawMessages, input, pendingHasFiles),
    enableHistoryCompaction ? historySummaryLastMessageId : undefined,
  );
  const messageCountMode = await warmContextTokenCache(
    afterCursor.map((message) => messageTextForTokenCount(message, inputTemplate)),
  );
  const messageTokenCount = (message: MessageLikeForHistoryWindow) =>
    countMessagesContextTokens([message], inputTemplate, model).totalTokens;
  const windowTokens = inputBudget || maxTokens;
  const effective = resolveEffectiveHistoryWindow({
    enableHistoryCount,
    fixedOverheadTokens,
    historyCount: configuredHistoryCount,
    inputTemplate,
    maxTokens: windowTokens,
    messageTokenCount,
    messagesAfterCursor: afterCursor,
  });
  const chats = selectMessagesForContext({
    cursorId: enableHistoryCompaction ? historySummaryLastMessageId : undefined,
    enableHistoryCount,
    fixedOverheadTokens,
    historyCount: configuredHistoryCount,
    inputTemplate,
    maxTokens: windowTokens,
    messageTokenCount,
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

  // C2 usage anchor: a verified provider totalInputTokens covers input through
  // that request. The tail (that reply and later rows) is counted locally and
  // scaled by the model multiplier. Without a verified anchor, the total is
  // the larger of the scaled whole window and the report plus the scaled tail,
  // so a stale report cannot shrink the badge and a new paste is not ignored.
  // The overhead delta uses the same tokenizer counter as the dispatch witness.
  const anchor = getLatestReportedInputAnchor(estimateMessages, usageLookupOptions);
  const anchorIndex = anchor ? chats.findIndex(({ id }) => id === anchor.id) : -1;
  const rawAnchorIndex = anchor ? rawMessages.findIndex(({ id }) => id === anchor.id) : -1;
  const fullPrefix = rawAnchorIndex >= 0 ? rawMessages.slice(0, rawAnchorIndex) : [];

  let chatsToken: number;
  let totalToken: number;
  let uncalibratedTokens: number;
  const anchorBaseline =
    anchor && anchorIndex >= 0 && rawAnchorIndex >= 0
      ? resolveAnchorBaseline({
          anchorId: anchor.id,
          anchorParentId: rawAnchorIndex > 0 ? rawMessages[rawAnchorIndex - 1]?.id : undefined,
          conversationKey: messageMapKey(chatState.activeId, chatState.activeTopicId),
          currentFixedOverheadTokens: fixedOverheadTokens,
          inputTemplate,
          prefixFingerprint: fingerprintAnchorPrefix(fullPrefix),
          reportedInputTokens: anchor.totalInputTokens,
          selectedPrefixIds: resolveSelectedPreAnchorIds({
            prefixMessages: fullPrefix,
            selectedMessages: estimateMessages,
          }),
        })
      : undefined;
  const wholeMessages = countMessagesContextTokens(chats, inputTemplate, model);
  const tailMessages =
    anchorIndex >= 0
      ? countMessagesContextTokens(chats.slice(anchorIndex), inputTemplate, model)
      : { hasVisual: false, textTokens: 0, totalTokens: 0, visualTokens: 0 };
  const localWhole = fixedTokens + wholeMessages.totalTokens;
  const scaledWhole = scaleLocalTokens(localWhole, multiplier);
  const scaledTail = scaleLocalTokens(
    tailMessages.totalTokens + (anchorBaseline?.overheadDelta ?? 0),
    multiplier,
  );
  const uncalibratedTail = tailMessages.totalTokens + (anchorBaseline?.overheadDelta ?? 0);

  if (anchor && anchorBaseline) {
    totalToken = anchor.totalInputTokens + scaledTail;
    uncalibratedTokens = anchor.totalInputTokens + uncalibratedTail;
    chatsToken = Math.max(0, totalToken - fixedTokens);
  } else {
    const reportedInput = getLatestReportedInputTokens(estimateMessages, usageLookupOptions);
    const floor = applyReportedInputTokenFloor(scaledWhole, reportedInput, scaledTail);
    const uncalibratedFloor = applyReportedInputTokenFloor(
      localWhole,
      reportedInput,
      uncalibratedTail,
    );
    chatsToken = wholeMessages.totalTokens + floor.chatsTokenDelta;
    totalToken = floor.totalToken;
    uncalibratedTokens = uncalibratedFloor.totalToken;
  }

  return {
    chatsToken,
    contextMessages: chats.filter(({ id }) => id !== PENDING_CONTEXT_INPUT_MESSAGE_ID),
    effectiveHistoryCount: resolveEffectiveHistoryCountForCompaction(
      effective,
      afterCursor.length,
    ),
    historySummaryToken,
    imageTokens: wholeMessages.visualTokens,
    includedMessageCount: chats.length,
    inputBudget,
    inputToken,
    memoryToken,
    multiplier,
    reservedOutput,
    systemRoleToken,
    tokenEstimateEligible: !wholeMessages.hasVisual && messageCountMode.mode === 'exact',
    toolsToken,
    totalToken,
    uncalibratedTokens,
  };
};
