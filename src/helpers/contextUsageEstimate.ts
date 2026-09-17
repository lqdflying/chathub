import { applyUserInputTemplate, getSlicedMessages, truncateToolResultContent } from '@lobechat/context-engine';
import { historySummaryPrompt } from '@lobechat/prompts';
import type { UIChatMessage } from '@lobechat/types';

import {
  CONTEXT_CHARS_PER_TOKEN_ESTIMATE,
  PENDING_CONTEXT_INPUT_MESSAGE_ID,
  appendPendingUserInputForContextWindow,
  getMessagesAfterHistorySummaryCursor,
  resolveEffectiveHistoryWindow,
} from '@/helpers/contextCompaction';
import type { EffectiveHistoryWindow } from '@/helpers/contextCompaction';

export {
  appendPendingUserInputForContextWindow,
  CONTEXT_CHARS_PER_TOKEN_ESTIMATE,
  type EffectiveHistoryWindow,
  LARGE_CONTEXT_EXPAND_WATERMARK,
  LARGE_CONTEXT_WINDOW_TOKENS,
  PENDING_CONTEXT_INPUT_MESSAGE_ID,
  resolveEffectiveHistoryWindow,
} from '@/helpers/contextCompaction';

export type MessageLikeForContextEstimate = Pick<
  UIChatMessage,
  'content' | 'role' | 'tool_call_id' | 'tools'
>;

export interface SerializeContextEstimateOptions {
  /**
   * Cap tool-result content like the request-assembly pipeline does
   * (ToolResultTruncateProcessor). Default true so estimates match the wire;
   * pass false for growth signals that should see the full stored content.
   */
  capToolResults?: boolean;
}

/** Serialize a chat row closer to the wire than content-only joins. */
export const serializeMessageForContextEstimate = (
  message: MessageLikeForContextEstimate,
  inputTemplate?: string,
  options?: SerializeContextEstimateOptions,
): string => {
  const rawContent =
    message.role === 'user'
      ? applyUserInputTemplate(inputTemplate, message.content ?? '')
      : (message.content ?? '');
  const content =
    message.role === 'tool' && options?.capToolResults !== false
      ? truncateToolResultContent(rawContent)
      : rawContent;
  const parts = [`${message.role ?? ''}:`, content];
  if (message.tool_call_id) parts.push(`tool_call_id:${message.tool_call_id}`);
  if (message.tools?.length) parts.push(JSON.stringify(message.tools));
  return parts.join('\n');
};

export const serializeMessagesForContextEstimate = (
  messages: MessageLikeForContextEstimate[],
  inputTemplate?: string,
  options?: SerializeContextEstimateOptions,
): string =>
  messages
    .map((message) => serializeMessageForContextEstimate(message, inputTemplate, options))
    .join('\n');

/**
 * Chars recoverable on the wire by the deterministic tool-result cap, expressed
 * in tokens with the CJK-safe ratio used by the other window math. Used by the
 * token-threshold planner to skip an LLM compaction when truncation alone
 * reaches the low watermark.
 */
export const estimateToolResultTruncationRecoveryTokens = (
  messages: Array<Pick<UIChatMessage, 'content' | 'role'>>,
): number => {
  let recoverableChars = 0;
  for (const message of messages) {
    if (message.role !== 'tool' || typeof message.content !== 'string') continue;
    // Per-message floor at 0: barely-over-cap content gets a marker longer than
    // the omitted text, which is not a recovery.
    recoverableChars += Math.max(
      0,
      message.content.length - truncateToolResultContent(message.content).length,
    );
  }
  return Math.ceil(recoverableChars / CONTEXT_CHARS_PER_TOKEN_ESTIMATE);
};

/** Match HistorySummaryProvider: count the XML wrapper, not only raw summary text. */
export const wrapHistorySummaryForTokenEstimate = (rawSummary: string): string => {
  const trimmed = rawSummary.trim();
  return trimmed ? historySummaryPrompt(trimmed) : '';
};

/**
 * Char-based estimate of every stable pre-history block the context-engine injects
 * before HistoryTruncate. Shared by UI, planner, browser builder, and durable payload.
 */
export const estimateFixedContextOverheadTokens = ({
  agentMemory = '',
  historySummaryRaw = '',
  skillInstructions = '',
  systemRole,
  toolsString = '',
}: {
  agentMemory?: string;
  historySummaryRaw?: string;
  skillInstructions?: string;
  systemRole?: string | null;
  toolsString?: string;
}): number => {
  const parts = [
    systemRole ?? '',
    agentMemory,
    wrapHistorySummaryForTokenEstimate(historySummaryRaw),
    toolsString,
    skillInstructions,
  ].join('');

  return Math.ceil(parts.length / CONTEXT_CHARS_PER_TOKEN_ESTIMATE);
};

export interface HistoryWindowDiagnostics {
  configuredHistoryCount: number;
  effectiveHistoryCount: number;
  enableHistoryCount: boolean;
  excludedByCursor: number;
  excludedByHistoryCount: number;
  expanded: boolean;
  hasTopicSummary: boolean;
  includedMessageCount: number;
  topicMessageCount: number;
  warnUncoveredExclusion: boolean;
}

export const getHistoryWindowDiagnostics = ({
  configuredHistoryCount,
  cursorId,
  enableCompressHistory,
  enableHistoryCount,
  fixedOverheadTokens,
  hasTopicSummary,
  historyCount,
  inputTemplate,
  maxTokens,
  messages,
  pendingHasFiles,
  pendingInput,
}: {
  configuredHistoryCount: number;
  cursorId?: string;
  enableCompressHistory?: boolean;
  enableHistoryCount?: boolean;
  fixedOverheadTokens?: number;
  hasTopicSummary: boolean;
  historyCount?: number;
  inputTemplate?: string;
  maxTokens?: number;
  messages: UIChatMessage[];
  pendingHasFiles?: boolean;
  pendingInput?: string;
}): HistoryWindowDiagnostics => {
  const topicMessageCount = messages.length;
  const nextRequestMessages = appendPendingUserInputForContextWindow(
    messages,
    pendingInput,
    pendingHasFiles,
  );
  const afterCursor = getMessagesAfterHistorySummaryCursor(
    nextRequestMessages,
    enableCompressHistory && enableHistoryCount ? cursorId : undefined,
  );
  const persistedAfterCursor = getMessagesAfterHistorySummaryCursor(
    messages,
    enableCompressHistory && enableHistoryCount ? cursorId : undefined,
  );
  const excludedByCursor = Math.max(0, topicMessageCount - persistedAfterCursor.length);

  const effective = resolveEffectiveHistoryWindow({
    enableHistoryCount,
    fixedOverheadTokens,
    historyCount,
    inputTemplate,
    maxTokens,
    messagesAfterCursor: afterCursor,
  });

  const included = getSlicedMessages(afterCursor, {
    enableHistoryCount: effective.enableHistoryCount,
    historyCount: effective.historyCount,
  });

  const excludedByHistoryCount = Math.max(0, afterCursor.length - included.length);
  const includedPersistedCount = included.filter(
    (message) => message.id !== PENDING_CONTEXT_INPUT_MESSAGE_ID,
  ).length;
  // A topic summary only covers rows through the cursor. Post-cursor history-count
  // exclusions are still uncovered until compaction advances that cursor.
  const warnUncoveredExclusion =
    (excludedByCursor > 0 && !hasTopicSummary) || excludedByHistoryCount > 0;

  return {
    configuredHistoryCount,
    effectiveHistoryCount: effective.enableHistoryCount
      ? effective.historyCount
      : persistedAfterCursor.length,
    enableHistoryCount: !!enableHistoryCount,
    excludedByCursor,
    excludedByHistoryCount,
    expanded: effective.expanded,
    hasTopicSummary,
    includedMessageCount: includedPersistedCount,
    topicMessageCount,
    warnUncoveredExclusion,
  };
};

export const getContextCompactionMaxSummaryTokens = (
  assistanceLevel?: 'minimal' | 'balanced' | 'rich' | string,
): number => {
  switch (assistanceLevel) {
    case 'minimal': {
      return 400;
    }
    case 'rich': {
      return 800;
    }
    default: {
      return 600;
    }
  }
};

/** Resolve the HistoryTruncate setting (not the included-row count after continuations). */
export const resolveEffectiveHistoryCountForCompaction = (
  effective: EffectiveHistoryWindow,
  messagesAfterCursorLength: number,
): number => {
  if (!effective.enableHistoryCount) return messagesAfterCursorLength;
  return effective.historyCount;
};
