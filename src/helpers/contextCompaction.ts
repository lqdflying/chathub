import { applyUserInputTemplate, getSlicedMessages } from '@lobechat/context-engine';
import {
  type GPT5ReasoningEffort,
  type MemoryCompactionTrigger,
  resolveGPT5ReasoningEffort,
  type UIChatMessage,
} from '@lobechat/types';
import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';

/** Models at or above this window may expand past configured historyCount when budget remains. */
export const LARGE_CONTEXT_WINDOW_TOKENS = 128_000;

/** Keep expanded history under this fraction of the model window (fixed overhead + chats). */
export const LARGE_CONTEXT_EXPAND_WATERMARK = 0.55;

/** CJK-safe rough chars→tokens for expand decisions (not the BPE estimator). */
export const CONTEXT_CHARS_PER_TOKEN_ESTIMATE = 2;

type MessageLikeForHistoryWindow = Pick<
  UIChatMessage,
  'content' | 'role' | 'tools' | 'tool_call_id'
>;

/** Synthetic row id for the unsent editor draft in next-request window math. */
export const PENDING_CONTEXT_INPUT_MESSAGE_ID = '__pending_input__';

/** Represent the pending editor input as the next user row, matching the post-send payload. */
export const appendPendingUserInputForContextWindow = (
  messages: UIChatMessage[],
  pendingInput?: string,
  pendingHasFiles?: boolean,
): UIChatMessage[] => {
  if (pendingInput) {
    return [
      ...messages,
      {
        content: pendingInput,
        id: PENDING_CONTEXT_INPUT_MESSAGE_ID,
        role: 'user',
      } as UIChatMessage,
    ];
  }

  if (pendingHasFiles) {
    return [
      ...messages,
      {
        content: '',
        id: PENDING_CONTEXT_INPUT_MESSAGE_ID,
        role: 'user',
      } as UIChatMessage,
    ];
  }

  return messages;
};

const serializeMessageForHistoryWindow = (
  message: MessageLikeForHistoryWindow,
  inputTemplate?: string,
): string => {
  const content =
    message.role === 'user'
      ? applyUserInputTemplate(inputTemplate, message.content ?? '')
      : (message.content ?? '');
  const parts = [`${message.role ?? ''}:`, content];
  if (message.tool_call_id) parts.push(`tool_call_id:${message.tool_call_id}`);
  if (message.tools?.length) parts.push(JSON.stringify(message.tools));
  return parts.join('\n');
};

const serializeMessagesForHistoryWindow = (
  messages: MessageLikeForHistoryWindow[],
  inputTemplate?: string,
): string =>
  messages.map((message) => serializeMessageForHistoryWindow(message, inputTemplate)).join('\n');

export interface EffectiveHistoryWindow {
  enableHistoryCount: boolean;
  /** True when the large-window path included more than the configured historyCount. */
  expanded: boolean;
  historyCount: number;
}

/**
 * For large context windows, grow (or disable) the message-count truncate while the
 * approximate next-request chat payload still fits under LARGE_CONTEXT_EXPAND_WATERMARK.
 * Small windows keep the configured historyCount unchanged.
 */
export const resolveEffectiveHistoryWindow = ({
  enableHistoryCount,
  fixedOverheadTokens = 0,
  historyCount,
  inputTemplate,
  maxTokens,
  messagesAfterCursor,
}: {
  enableHistoryCount?: boolean;
  fixedOverheadTokens?: number;
  historyCount?: number;
  /** Applied to every included user row; must not be counted again as fixed overhead. */
  inputTemplate?: string;
  maxTokens?: number;
  messagesAfterCursor: MessageLikeForHistoryWindow[];
}): EffectiveHistoryWindow => {
  if (!enableHistoryCount || historyCount === undefined) {
    return { enableHistoryCount: false, expanded: false, historyCount: historyCount ?? 0 };
  }

  if (historyCount <= 0) {
    return { enableHistoryCount: true, expanded: false, historyCount };
  }

  if (!maxTokens || maxTokens < LARGE_CONTEXT_WINDOW_TOKENS) {
    return { enableHistoryCount: true, expanded: false, historyCount };
  }

  const budgetTokens =
    Math.floor(maxTokens * LARGE_CONTEXT_EXPAND_WATERMARK) - Math.max(0, fixedOverheadTokens);
  if (budgetTokens <= 0) {
    return { enableHistoryCount: true, expanded: false, historyCount };
  }

  const approxTokens = (messages: MessageLikeForHistoryWindow[]) =>
    Math.ceil(
      serializeMessagesForHistoryWindow(messages, inputTemplate).length /
        CONTEXT_CHARS_PER_TOKEN_ESTIMATE,
    );

  if (approxTokens(messagesAfterCursor) <= budgetTokens) {
    return { enableHistoryCount: false, expanded: true, historyCount };
  }

  let best = historyCount;
  for (let n = messagesAfterCursor.length; n > historyCount; n -= 1) {
    const sliced = getSlicedMessages(messagesAfterCursor, {
      enableHistoryCount: true,
      historyCount: n,
    }) as MessageLikeForHistoryWindow[];
    if (approxTokens(sliced) <= budgetTokens) {
      best = n;
      break;
    }
  }

  return {
    enableHistoryCount: true,
    expanded: best > historyCount,
    historyCount: best,
  };
};

export const CONTEXT_COMPACTION_DEFAULT_HIGH_WATERMARK = 0.8;
export const CONTEXT_COMPACTION_WATERMARK_GAP = 0.2;
export const CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS = 400;
export const CONTEXT_COMPACTION_REASONING_HEADROOM_TOKENS = 2048;
export const CONTEXT_COMPACTION_MAX_BATCH_MESSAGES = 40;

export interface SimpleCompletionSampling {
  max_tokens?: number;
  reasoning_effort?: GPT5ReasoningEffort;
  thinking?: { budget_tokens: number; type: 'disabled' };
}

/**
 * Only the exact provider+id card. A matching id on another provider is not
 * used — custom gateways must not inherit DeepSeek/OpenAI thinking fields.
 */
const findSimpleCompletionModelCard = (model: string, provider?: string) => {
  if (provider) {
    return LOBE_DEFAULT_MODEL_LIST.find(
      (item) => item.id === model && item.providerId === provider,
    );
  }

  return LOBE_DEFAULT_MODEL_LIST.find((item) => item.id === model);
};

const isGpt5ReasoningModelId = (model: string) =>
  model.startsWith('gpt-5') && !model.includes('chat');

const usesDocumentedThinkingTypeOff = ({
  cardUsesThinkingType,
  provider,
}: {
  cardUsesThinkingType: boolean;
  provider?: string;
}) => {
  if (provider === ModelProvider.Anthropic || provider === ModelProvider.AnthropicCompatible) {
    return true;
  }

  // Only listed cards: unknown DeepSeek/MiMo/Moonshot/Zhipu IDs must not invent `thinking`.
  return (
    cardUsesThinkingType &&
    (provider === ModelProvider.DeepSeek ||
      provider === ModelProvider.Mimo ||
      provider === ModelProvider.Moonshot ||
      provider === ModelProvider.Zhipu)
  );
};

/**
 * Sampling for title / translation / history-summary completions.
 * Pass `summaryMaxTokens` only when the caller wants an output cap
 * (compaction). Translation must omit it so long messages are not truncated.
 * The prompt uses the same Assist-preset cap (400/600/800); the API budget must
 * also cover thinking tokens that share the completion cap on reasoning models.
 */
export const buildSimpleCompletionSampling = ({
  model,
  provider,
  summaryMaxTokens,
}: {
  model: string;
  provider?: string;
  summaryMaxTokens?: number;
}): SimpleCompletionSampling => {
  const card = findSimpleCompletionModelCard(model, provider);
  const extendParams = card?.settings?.extendParams ?? [];
  const cardUsesThinkingType =
    Boolean(card?.abilities?.reasoning) ||
    extendParams.includes('thinking') ||
    extendParams.includes('enableReasoning');
  const sendGpt5Effort =
    extendParams.includes('gpt5ReasoningEffort') || (!card && isGpt5ReasoningModelId(model));
  const sendThinkingDisabled = usesDocumentedThinkingTypeOff({ cardUsesThinkingType, provider });
  const needsReasoningBudget =
    cardUsesThinkingType ||
    sendGpt5Effort ||
    sendThinkingDisabled ||
    extendParams.includes('reasoningEffort') ||
    !card;

  const sampling: SimpleCompletionSampling = {};

  if (typeof summaryMaxTokens === 'number') {
    sampling.max_tokens = needsReasoningBudget
      ? summaryMaxTokens + CONTEXT_COMPACTION_REASONING_HEADROOM_TOKENS
      : summaryMaxTokens;
  }

  if (sendGpt5Effort) {
    sampling.reasoning_effort = resolveGPT5ReasoningEffort(model, 'minimal').effort;
  }

  if (sendThinkingDisabled) {
    sampling.thinking = { budget_tokens: 0, type: 'disabled' };
  }

  return sampling;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const getContextCompactionWatermarks = (configuredHigh?: number) => {
  const high = clamp(configuredHigh ?? CONTEXT_COMPACTION_DEFAULT_HIGH_WATERMARK, 0.5, 0.99);

  return {
    high,
    low: Math.max(0.1, Number((high - CONTEXT_COMPACTION_WATERMARK_GAP).toFixed(2))),
  };
};

export const getMainTopicMessages = (messages: UIChatMessage[]) =>
  messages.filter((message) => !message.threadId);

export const getMessagesAfterHistorySummaryCursor = (
  messages: UIChatMessage[],
  cursorId?: string,
): UIChatMessage[] => {
  if (!cursorId) return messages;

  const cursorIndex = messages.findIndex(({ id }) => id === cursorId);
  return cursorIndex < 0 ? messages : messages.slice(cursorIndex + 1);
};

export const selectMessagesForContext = ({
  cursorId,
  enableHistoryCount,
  fixedOverheadTokens,
  historyCount,
  inputTemplate,
  maxTokens,
  messages,
  pendingHasFiles,
  pendingInput,
}: {
  cursorId?: string;
  enableHistoryCount?: boolean;
  fixedOverheadTokens?: number;
  historyCount?: number;
  inputTemplate?: string;
  maxTokens?: number;
  messages: UIChatMessage[];
  pendingHasFiles?: boolean;
  pendingInput?: string;
}) => {
  const nextRequestMessages = appendPendingUserInputForContextWindow(
    messages,
    pendingInput,
    pendingHasFiles,
  );
  const afterCursor = getMessagesAfterHistorySummaryCursor(nextRequestMessages, cursorId);
  const effective = resolveEffectiveHistoryWindow({
    enableHistoryCount,
    fixedOverheadTokens,
    historyCount,
    inputTemplate,
    maxTokens,
    messagesAfterCursor: afterCursor,
  });

  return getSlicedMessages(afterCursor, {
    enableHistoryCount: effective.enableHistoryCount,
    historyCount: effective.historyCount,
  }) as UIChatMessage[];
};

export interface PendingCompactionHistory {
  pendingMessages: UIChatMessage[];
  previousSummary: string;
  rebuildingSummary: boolean;
}

export const resolvePendingCompactionHistory = ({
  cursorId,
  historySummary,
  messages,
}: {
  cursorId?: string;
  historySummary?: string;
  messages: UIChatMessage[];
}): PendingCompactionHistory => {
  const cursorIndex = cursorId ? messages.findIndex(({ id }) => id === cursorId) : -1;
  const hasSummary = !!historySummary?.trim();

  if (cursorIndex >= 0) {
    return {
      pendingMessages: messages.slice(cursorIndex + 1),
      previousSummary: historySummary?.trim() ?? '',
      rebuildingSummary: false,
    };
  }

  return {
    pendingMessages: messages,
    previousSummary: '',
    rebuildingSummary: hasSummary,
  };
};

/** Prefixes always end immediately before a later user turn, so active tool tails stay intact. */
export const getSettledCompactionPrefixes = (messages: UIChatMessage[]): UIChatMessage[][] => {
  const latestUserIndex = messages.findLastIndex(({ role }) => role === 'user');
  if (latestUserIndex <= 0) return [];

  const eligibleMessages = messages.slice(0, latestUserIndex);
  const prefixes: UIChatMessage[][] = [];
  let hasUserMessage = false;

  for (let index = 0; index < eligibleMessages.length; index += 1) {
    if (eligibleMessages[index].role === 'user') hasUserMessage = true;
    if (hasUserMessage && messages[index + 1]?.role === 'user') {
      prefixes.push(eligibleMessages.slice(0, index + 1));
    }
  }

  return prefixes;
};

export const selectMessageCountCompactionPrefix = (
  pendingMessages: UIChatMessage[],
  historyCount: number,
): UIChatMessage[] => {
  const prefixes = getSettledCompactionPrefixes(pendingMessages);
  if (!prefixes.length) return [];

  const keptMessages = getSlicedMessages(pendingMessages, {
    enableHistoryCount: true,
    historyCount,
  });
  const firstKeptId = keptMessages[0]?.id;
  const firstKeptIndex = firstKeptId
    ? pendingMessages.findIndex(({ id }) => id === firstKeptId)
    : pendingMessages.length;

  if (firstKeptIndex <= 0) return [];

  return prefixes.find((prefix) => prefix.length >= firstKeptIndex) ?? prefixes.at(-1) ?? [];
};

export const selectDefaultCompactionPrefix = (
  pendingMessages: UIChatMessage[],
  trigger: MemoryCompactionTrigger,
  historyCount: number,
) => {
  if (trigger === 'message_count') {
    return selectMessageCountCompactionPrefix(pendingMessages, historyCount);
  }

  return getSettledCompactionPrefixes(pendingMessages).at(-1) ?? [];
};

export const splitCompactionBatches = (
  messages: UIChatMessage[],
  maxMessages = CONTEXT_COMPACTION_MAX_BATCH_MESSAGES,
): UIChatMessage[][] => {
  if (!messages.length) return [];

  const batches: UIChatMessage[][] = [];
  let remaining = messages;

  while (remaining.length > 0) {
    if (remaining.length <= maxMessages) {
      batches.push(remaining);
      break;
    }

    let batchEnd = -1;
    for (let index = 0; index < Math.min(maxMessages, remaining.length); index += 1) {
      if (remaining[index + 1]?.role === 'user') batchEnd = index + 1;
    }

    if (batchEnd < 0) {
      const nextTurnIndex = remaining.findIndex(
        ({ role }, index) => index >= maxMessages && role === 'user',
      );
      batchEnd = nextTurnIndex > 0 ? nextTurnIndex : remaining.length;
    }

    batches.push(remaining.slice(0, batchEnd));
    remaining = remaining.slice(batchEnd);
  }

  return batches;
};

export const createCompactionFingerprint = ({
  cursorId,
  messages,
  summary,
}: {
  cursorId?: string;
  messages: UIChatMessage[];
  summary?: string;
}) =>
  [
    cursorId ?? '',
    summary?.length ?? 0,
    ...messages.map(
      ({ content, id, role, updatedAt }) =>
        `${id}:${role}:${updatedAt ? new Date(updatedAt).toISOString() : ''}:${content.length}`,
    ),
  ].join('|');
