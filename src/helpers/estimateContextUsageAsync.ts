import { applyUserInputTemplate, formatSkillInstructionsBlock } from '@lobechat/context-engine';
import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_MODEL, DEFAULT_PROVIDER } from '@lobechat/const';
import { agentMemoryPrompt } from '@lobechat/prompts';
import { ChatTopicMetadata, LobeAgentConfig } from '@lobechat/types';

import { getModelContextWindowTokens } from '@/helpers/modelContextWindowTokens';
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
  overrides?: EstimateContextUsageOverrides;
}

const countTokens = async (value: string) => {
  try {
    return await encodeAsync(value);
  } catch {
    return value.length;
  }
};

export interface FixedContextOverheadInput {
  agentMemory: string;
  /** Shared-unit (chars/2) fixed overhead via `estimateFixedContextOverheadTokens`. */
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
  // whole-window tokenizer estimate, which undercounts CJK ~3x. Without a
  // VERIFIED anchor, fall back to the whole-window estimate floored by
  // reported usage (applyReportedInputTokenFloor), exactly as before.
  // F5/R3: a verified anchor adds the fixed-overhead delta (skills,
  // instructions, memory, tools) and a changed message prefix invalidates the
  // anchor permanently until a fresh report. R4: the baseline registry is
  // shared with the token popover hook, so the delta MUST use the same
  // chars/2 overhead measure (`fixedOverheadTokens`), not the tokenized
  // `fixedTokens` used for the final chats math below. D2/T1: an anchor is
  // only verified when a dispatch-time witness recorded by the send path for
  // THIS assistant row still matches — estimators never record witnesses, so
  // a report from a request this process never dispatched (reload, other
  // topic's snapshot) always falls back. Parent and content fingerprint use
  // the FULL conversation prefix so window *sliding* (older rows dropping
  // out) cannot break the match. Selected pre-anchor ids are compared
  // separately: newly included older rows invalidate (U2). A changed
  // input template also invalidates (U3): the report counted the original
  // expansion on every included user row, and the tail-only serialize
  // would omit that added text on pre-anchor history.
  const anchor = getLatestReportedInputAnchor(estimateMessages, usageLookupOptions);
  const anchorIndex = anchor ? chats.findIndex(({ id }) => id === anchor.id) : -1;
  const rawAnchorIndex = anchor ? rawMessages.findIndex(({ id }) => id === anchor.id) : -1;
  const fullPrefix = rawAnchorIndex >= 0 ? rawMessages.slice(0, rawAnchorIndex) : [];

  let chatsToken: number;
  let totalToken: number;
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
  if (anchor && anchorBaseline) {
    const tailToken = await countTokens(
      serializeMessagesForContextEstimate(chats.slice(anchorIndex), inputTemplate),
    );
    totalToken = anchor.totalInputTokens + tailToken + anchorBaseline.overheadDelta;
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
