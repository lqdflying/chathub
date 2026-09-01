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
 * Messages strictly after `afterMessageId`. A missing id fail-closes to an
 * empty window so a deleted watermark cannot revive older usage as “fresh”.
 */
export const messagesAfterId = <T extends { id?: string }>(
  messages: T[],
  afterMessageId?: string,
): T[] => {
  if (!afterMessageId) return messages;
  const index = messages.findIndex((message) => message.id === afterMessageId);
  return index < 0 ? [] : messages.slice(index + 1);
};

/**
 * Newest assistant/group in the window, including in-flight `LOADING_FLAT`
 * placeholders. Compact stamps this as the generation boundary so a request
 * that straddles compaction cannot floor the next estimate with pre-compact
 * usage when that placeholder later finalizes.
 */
export const getReportedInputTokenFloorBoundaryId = (
  messages: UsageMessage[],
): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isAssistantLike(message) && message.id) return message.id;
  }
  return undefined;
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
 * row is gone). Compacted topics without a watermark (legacy) exclude every
 * assistant already in the sliced window until a later row is stamped.
 */
export const getEffectiveReportedInputTokenFloorAfterMessageId = ({
  cursorId,
  messages,
  storedAfterMessageId,
}: {
  cursorId?: string;
  messages: UsageMessage[];
  storedAfterMessageId?: string;
}): string | undefined => {
  if (storedAfterMessageId) return storedAfterMessageId;
  if (cursorId) return getReportedInputTokenFloorBoundaryId(messages);
  return undefined;
};

/** Newest settled assistant `totalInputTokens` in the supplied window. */
export const getLatestReportedInputTokens = (
  messages: UsageMessage[],
  options?: { afterMessageId?: string },
): number | undefined => {
  const window = messagesAfterId(messages, options?.afterMessageId);
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
  const nextId = getReportedInputTokenFloorBoundaryId(remainingMessages);
  const nextMetadata = { ...metadata };
  delete nextMetadata.reportedInputTokenFloorAfterMessageId;
  if (nextId) nextMetadata.reportedInputTokenFloorAfterMessageId = nextId;
  return nextMetadata;
};
