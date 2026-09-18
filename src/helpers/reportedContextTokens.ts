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

export interface ReportedInputAnchor {
  id: string;
  totalInputTokens: number;
}

/**
 * Newest settled assistant with provider-reported `totalInputTokens`, with its
 * id, in the supplied window. This is the C2 usage anchor: the reported value
 * exactly covers the fixed overhead plus every message up to that request, so
 * estimators only need to tokenize the tail (the anchor's own reply and later
 * messages) instead of the whole window.
 */
export const getLatestReportedInputAnchor = (
  messages: UsageMessage[],
  options?: { afterMessageId?: string; lookupMessages?: UsageMessage[] },
): ReportedInputAnchor | undefined => {
  const window = messagesAfterId(messages, options?.afterMessageId, options?.lookupMessages);
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const value = readReportedInputFromMessage(window[index]);
    const id = window[index].id;
    if (value && id) return { id, totalInputTokens: value };
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

// --- C2 usage-anchor baseline (F5) ---

const toEpochMs = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

/**
 * Cheap fingerprint of the request prefix an anchor's reported input covered:
 * message count + content chars + newest edit time of the rows before the
 * anchor. No tokenization — any pre-anchor add/delete/edit or history-window
 * shift changes the fingerprint and invalidates the baseline.
 */
export const fingerprintAnchorPrefix = (
  messages: Array<{ content?: unknown; updatedAt?: unknown }>,
): string => {
  let chars = 0;
  let maxUpdatedAt = 0;
  for (const message of messages) {
    chars += String(message.content ?? '').length;
    const updatedAt = toEpochMs(message.updatedAt);
    if (updatedAt > maxUpdatedAt) maxUpdatedAt = updatedAt;
  }
  return `${messages.length}:${chars}:${maxUpdatedAt}`;
};

interface AnchorBaseline {
  fixedOverheadTokens: number;
  prefixFingerprint: string;
}

/**
 * Process-local retained request snapshots, keyed by anchor message id. The
 * anchor's provider-reported input exactly covered the fixed overhead and
 * history prefix of ITS request; to keep the anchored total correct, later
 * estimates must add the fixed-overhead delta (skill/system/memory/tools
 * changes) and fall back to the whole-window estimate when the prefix no
 * longer corresponds (F5). A prefix mismatch never re-baselines (R3): the
 * report covered the original prefix, so the anchor stays invalid until a
 * fresh provider report arrives under a new anchor id. Both callers must pass
 * the SAME overhead measure (`estimateFixedContextOverheadTokens`, chars/4) —
 * the map is shared, so mixed units would register as phantom context (R4).
 */
const anchorBaselines = new Map<string, AnchorBaseline>();
const ANCHOR_BASELINE_LIMIT = 500;

const registerAnchorBaseline = (anchorId: string, baseline: AnchorBaseline) => {
  if (anchorBaselines.size >= ANCHOR_BASELINE_LIMIT && !anchorBaselines.has(anchorId)) {
    const oldest = anchorBaselines.keys().next().value;
    if (oldest !== undefined) anchorBaselines.delete(oldest);
  }
  anchorBaselines.set(anchorId, baseline);
};

/** Test support: drop all retained baselines (module state survives across tests in a file). */
export const clearAnchorBaselines = () => {
  anchorBaselines.clear();
};

/**
 * Resolve the anchor's retained baseline, or `undefined` when the prefix no
 * longer corresponds and the caller must fall back to the whole-window
 * estimate. First sight of an anchor registers the current state as the
 * baseline (delta 0). On a prefix mismatch the baseline is **kept**, not
 * re-registered: the anchor's provider report covered the ORIGINAL prefix, so
 * re-baselining onto an edited prefix would re-trust a report that never
 * counted those messages (R3). The anchor therefore stays invalid — every
 * estimate falls back to the whole window — until a fresh provider report
 * arrives under a new anchor id.
 * The returned delta is floored so the anchored total can never drop below
 * what the next request minimally contains (current overhead + tail).
 */
export const resolveAnchorBaseline = ({
  anchorId,
  currentFixedOverheadTokens,
  prefixFingerprint,
  reportedInputTokens,
}: {
  anchorId: string;
  currentFixedOverheadTokens: number;
  prefixFingerprint: string;
  reportedInputTokens: number;
}): { overheadDelta: number } | undefined => {
  const cached = anchorBaselines.get(anchorId);
  if (!cached) {
    registerAnchorBaseline(anchorId, {
      fixedOverheadTokens: currentFixedOverheadTokens,
      prefixFingerprint,
    });
    return { overheadDelta: 0 };
  }
  if (cached.prefixFingerprint !== prefixFingerprint) {
    return undefined;
  }
  const overheadDelta = currentFixedOverheadTokens - cached.fixedOverheadTokens;
  return {
    overheadDelta:
      overheadDelta < 0
        ? Math.max(overheadDelta, currentFixedOverheadTokens - reportedInputTokens)
        : overheadDelta,
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
