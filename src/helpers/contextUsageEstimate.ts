import { historySummaryPrompt } from '@lobechat/prompts';
import type { UIChatMessage } from '@lobechat/types';
import { getSlicedMessages } from '@lobechat/context-engine';

import {
  getMessagesAfterHistorySummaryCursor,
  resolveEffectiveHistoryWindow,
} from '@/helpers/contextCompaction';

export {
  CONTEXT_CHARS_PER_TOKEN_ESTIMATE,
  LARGE_CONTEXT_EXPAND_WATERMARK,
  LARGE_CONTEXT_WINDOW_TOKENS,
  resolveEffectiveHistoryWindow,
  type EffectiveHistoryWindow,
} from '@/helpers/contextCompaction';

export type MessageLikeForContextEstimate = Pick<
  UIChatMessage,
  'content' | 'role' | 'tools' | 'tool_call_id'
>;

/** Serialize a chat row closer to the wire than content-only joins. */
export const serializeMessageForContextEstimate = (
  message: MessageLikeForContextEstimate,
): string => {
  const parts = [`${message.role ?? ''}:`, message.content ?? ''];
  if (message.tool_call_id) parts.push(`tool_call_id:${message.tool_call_id}`);
  if (message.tools?.length) parts.push(JSON.stringify(message.tools));
  return parts.join('\n');
};

export const serializeMessagesForContextEstimate = (
  messages: MessageLikeForContextEstimate[],
): string => messages.map(serializeMessageForContextEstimate).join('\n');

/** Match HistorySummaryProvider: count the XML wrapper, not only raw summary text. */
export const wrapHistorySummaryForTokenEstimate = (rawSummary: string): string => {
  const trimmed = rawSummary.trim();
  return trimmed ? historySummaryPrompt(trimmed) : '';
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
  maxTokens,
  messages,
}: {
  configuredHistoryCount: number;
  cursorId?: string;
  enableCompressHistory?: boolean;
  enableHistoryCount?: boolean;
  fixedOverheadTokens?: number;
  hasTopicSummary: boolean;
  historyCount?: number;
  maxTokens?: number;
  messages: UIChatMessage[];
}): HistoryWindowDiagnostics => {
  const topicMessageCount = messages.length;
  const afterCursor = getMessagesAfterHistorySummaryCursor(
    messages,
    enableCompressHistory && enableHistoryCount ? cursorId : undefined,
  );
  const excludedByCursor = Math.max(0, topicMessageCount - afterCursor.length);

  const effective = resolveEffectiveHistoryWindow({
    enableHistoryCount,
    fixedOverheadTokens,
    historyCount,
    maxTokens,
    messagesAfterCursor: afterCursor,
  });

  const included = getSlicedMessages(afterCursor, {
    enableHistoryCount: effective.enableHistoryCount,
    historyCount: effective.historyCount,
  });

  const excludedByHistoryCount = Math.max(0, afterCursor.length - included.length);
  const warnUncoveredExclusion =
    excludedByCursor + excludedByHistoryCount > 0 && !hasTopicSummary;

  return {
    configuredHistoryCount,
    effectiveHistoryCount: effective.enableHistoryCount
      ? effective.historyCount
      : afterCursor.length,
    enableHistoryCount: !!enableHistoryCount,
    excludedByCursor,
    excludedByHistoryCount,
    expanded: effective.expanded,
    hasTopicSummary,
    includedMessageCount: included.length,
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
    case 'balanced':
    default: {
      return 600;
    }
  }
};
