import { getSlicedMessages } from '@lobechat/context-engine';
import type { MemoryCompactionTrigger, UIChatMessage } from '@lobechat/types';

export const CONTEXT_COMPACTION_DEFAULT_HIGH_WATERMARK = 0.8;
export const CONTEXT_COMPACTION_WATERMARK_GAP = 0.2;
export const CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS = 400;
export const CONTEXT_COMPACTION_MAX_BATCH_MESSAGES = 40;

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
  historyCount,
  messages,
}: {
  cursorId?: string;
  enableHistoryCount?: boolean;
  historyCount?: number;
  messages: UIChatMessage[];
}) =>
  getSlicedMessages(getMessagesAfterHistorySummaryCursor(messages, cursorId), {
    enableHistoryCount,
    historyCount,
  }) as UIChatMessage[];

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
