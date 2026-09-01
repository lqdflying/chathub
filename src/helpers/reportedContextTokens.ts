import type {
  ChatTopicMetadata,
  MessageMetadata,
  ModelTokensUsage,
  UIChatMessage,
} from '@lobechat/types';

import { LOADING_FLAT } from '@/const/message';

type UsageMessage = Pick<
  UIChatMessage,
  'children' | 'content' | 'createdAt' | 'id' | 'metadata' | 'role' | 'updatedAt' | 'usage'
>;

type NestedUsageMetadata = MessageMetadata & { usage?: ModelTokensUsage };

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isAssistantLike = (message: UsageMessage): boolean =>
  message.role === 'assistant' || message.role === 'group';

const readTotalInput = (usage?: ModelTokensUsage | MessageMetadata | null): number | undefined => {
  if (!usage || typeof usage !== 'object') return undefined;
  const total = (usage as ModelTokensUsage).totalInputTokens;
  return isFinitePositive(total) ? total : undefined;
};

const readReportedInputFromMessage = (message: UsageMessage): number | undefined => {
  if (!isAssistantLike(message) || message.content === LOADING_FLAT) {
    return undefined;
  }

  const children = message.children;
  if (children?.length) {
    for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
      const childInput = readTotalInput(children[childIndex].usage);
      if (childInput) return childInput;
    }
  }

  const nested = (message.metadata as NestedUsageMetadata | undefined)?.usage;
  return readTotalInput(message.usage) ?? readTotalInput(nested) ?? readTotalInput(message.metadata);
};

/**
 * Messages strictly after `afterMessageId` in `lookupMessages` order (defaults
 * to `messages`). A missing id fail-closes to an empty window so a deleted
 * watermark cannot revive older usage as “fresh”. When the marker is older
 * than a HistoryTruncate slice, later selected rows still floor.
 */
export const messagesAfterId = <T extends { id?: string }>(
  messages: T[],
  afterMessageId?: string,
  lookupMessages: T[] = messages,
): T[] => {
  if (!afterMessageId) return messages;
  const index = lookupMessages.findIndex((message) => message.id === afterMessageId);
  if (index < 0) return [];
  if (lookupMessages === messages) return messages.slice(index + 1);

  const afterIds = new Set<string>();
  for (const message of lookupMessages.slice(index + 1)) {
    if (message.id) afterIds.add(message.id);
  }
  return messages.filter((message) => !!message.id && afterIds.has(message.id));
};

/** Remaining topic rows after the compaction cursor. A missing cursor keeps the list. */
export const remainingMessagesAfterCursor = <T extends { id?: string }>(
  messages: T[],
  cursorId?: string,
): T[] => {
  if (!cursorId) return messages;
  const index = messages.findIndex((message) => message.id === cursorId);
  return index < 0 ? messages : messages.slice(index + 1);
};

/**
 * Newest assistant/group in the window, including in-flight `LOADING_FLAT`
 * placeholders; otherwise the newest message with an id (protected user after
 * compact). Compact stamps this as the generation boundary so a request that
 * straddles compaction cannot floor the next estimate with pre-compact usage
 * when that placeholder later finalizes.
 */
export const getReportedInputTokenFloorBoundaryId = (
  messages: UsageMessage[],
): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isAssistantLike(message) && message.id) return message.id;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.id) return message.id;
  }
  return undefined;
};

/**
 * Persisted watermark: keep a stored id still present in the topic; otherwise
 * stamp the remaining post-cursor window (legacy migration or deleted row).
 * An empty remaining window keeps the compaction cursor so a later reply is
 * unambiguously after the boundary instead of becoming a new migration mark.
 */
export const nextReportedInputTokenFloorAfterMessageId = ({
  cursorId,
  storedAfterMessageId,
  topicMessages,
}: {
  cursorId?: string;
  storedAfterMessageId?: string;
  topicMessages: UsageMessage[];
}): string | undefined => {
  if (storedAfterMessageId && topicMessages.some((message) => message.id === storedAfterMessageId)) {
    return storedAfterMessageId;
  }
  if (!cursorId && !storedAfterMessageId) return undefined;
  return (
    getReportedInputTokenFloorBoundaryId(remainingMessagesAfterCursor(topicMessages, cursorId)) ??
    cursorId
  );
};

/** Newest settled assistant that currently reports `totalInputTokens`. */
export const getLatestReportedInputTokenSourceId = (messages: UsageMessage[]): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (readReportedInputFromMessage(message) && message.id) return message.id;
  }
  return undefined;
};

/**
 * Floor boundary for estimators: a stored watermark wins (fail-closed if the
 * row is gone from the full topic). Compacted topics without a watermark
 * (legacy) exclude assistants already in the remaining post-cursor window
 * until that id is persisted.
 */
export const getEffectiveReportedInputTokenFloorAfterMessageId = ({
  cursorId,
  messages,
  storedAfterMessageId,
  topicMessages,
}: {
  cursorId?: string;
  messages: UsageMessage[];
  storedAfterMessageId?: string;
  topicMessages?: UsageMessage[];
}): string | undefined => {
  const lookup = topicMessages ?? messages;
  if (storedAfterMessageId) return storedAfterMessageId;
  if (cursorId) {
    return (
      getReportedInputTokenFloorBoundaryId(remainingMessagesAfterCursor(lookup, cursorId)) ??
      cursorId
    );
  }
  return undefined;
};

/** Newest settled assistant `totalInputTokens` in the supplied window. */
export const getLatestReportedInputTokens = (
  messages: UsageMessage[],
  options?: { afterMessageId?: string; lookupMessages?: UsageMessage[] },
): number | undefined => {
  const window = messagesAfterId(messages, options?.afterMessageId, options?.lookupMessages);
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const value = readReportedInputFromMessage(window[index]);
    if (value) return value;
  }

  return undefined;
};

export const applyReportedInputTokenFloor = (
  estimatedTotal: number,
  reportedInput?: number,
): { chatsTokenDelta: number; totalToken: number } => {
  if (!reportedInput || reportedInput <= estimatedTotal) {
    return { chatsTokenDelta: 0, totalToken: estimatedTotal };
  }
  return {
    chatsTokenDelta: reportedInput - estimatedTotal,
    totalToken: reportedInput,
  };
};

/** Replace (or drop) the floor watermark from remaining post-cursor messages. */
export const withReportedInputTokenFloorMetadata = (
  metadata: ChatTopicMetadata,
  remainingMessages: UsageMessage[],
): ChatTopicMetadata => {
  const nextId =
    getReportedInputTokenFloorBoundaryId(remainingMessages) ??
    metadata.historySummaryLastMessageId;
  const nextMetadata = { ...metadata };
  delete nextMetadata.reportedInputTokenFloorAfterMessageId;
  if (nextId) nextMetadata.reportedInputTokenFloorAfterMessageId = nextId;
  return nextMetadata;
};
