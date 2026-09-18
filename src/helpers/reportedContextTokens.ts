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
 * Cheap fingerprint of the FULL conversation prefix an anchor's reported input
 * covered: message count + content chars + newest edit time of the rows before
 * the anchor. No tokenization — any pre-anchor add/delete/edit changes the
 * fingerprint and invalidates the baseline. History-window *selection* is a
 * separate check (`selectedPrefixIds`): sliding the window so older rows drop
 * out keeps the anchor (those tokens are no longer sent; overcount is safe),
 * but newly included older rows must fall back (U2).
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

/**
 * Pre-anchor rows that the current history window actually includes. Used to
 * detect a selection that grew (widen / disable limit / effective-window
 * expand) without treating a slide that *drops* older rows as a mismatch.
 */
export const resolveSelectedPreAnchorIds = ({
  prefixMessages,
  selectedMessages,
}: {
  prefixMessages: Array<{ id?: string }>;
  selectedMessages: Array<{ id?: string }>;
}): string[] => {
  const selectedIds = new Set(
    selectedMessages.map((message) => message.id).filter((id): id is string => !!id),
  );
  return prefixMessages
    .map((message) => message.id)
    .filter((id): id is string => !!id && selectedIds.has(id));
};

const selectionIncludesUnsentPrefix = (storedIds: string[], currentIds?: string[]) => {
  if (!currentIds) return false;
  const stored = new Set(storedIds);
  return currentIds.some((id) => !stored.has(id));
};

const normalizeAnchorInputTemplate = (value?: string) => (value ?? '').trim();

const inputTemplateChanged = (stored: string, current?: string) => {
  if (current === undefined) return false;
  return normalizeAnchorInputTemplate(stored) !== normalizeAnchorInputTemplate(current);
};

interface AnchorBaseline {
  fixedOverheadTokens: number;
  /** Normalized input template the original request applied to user rows (U3). */
  inputTemplate: string;
  prefixFingerprint: string;
  selectedPrefixIds: string[];
}

/**
 * Process-local retained request baselines, keyed by anchor message id. A
 * baseline may only be registered by PROMOTING the dispatch-time witness this
 * process recorded for that exact request (D2/T1): first observation of a
 * reported anchor is not evidence the report measured the current prefix (the
 * edit may predate this process — reload, new tab, cache eviction), so an
 * unverified anchor always falls back to the whole-window estimate. A prefix
 * mismatch never re-baselines (R3): the report covered the original prefix, so
 * the anchor stays invalid until a fresh provider report arrives under a new
 * anchor id. Both callers must pass the SAME overhead measure
 * (`estimateFixedContextOverheadTokens`, chars/2) — the map is shared, so mixed
 * units would register as phantom context (R4).
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

interface AnchorRequestWitness {
  /** Conversation the request was dispatched in (`messageMapKey`). */
  conversationKey: string;
  fixedOverheadTokens: number;
  inputTemplate: string;
  /** Row the pending assistant was parented to at dispatch. */
  parentMessageId?: string;
  prefixFingerprint: string;
  /** Selected pre-anchor row ids the dispatched request actually included. */
  selectedPrefixIds: string[];
}

/**
 * Request witnesses (D2/T1 round 5): one immutable entry per dispatched
 * request, keyed by the pending assistant message id. A witness is recorded
 * ONLY by the dispatch path (send / retry / tool continuation) at the moment
 * the request is assembled — never by the estimators. Estimate-time recording
 * cannot distinguish "first sight of a pending row at dispatch" from "first
 * sight after reload / navigation", so a snapshot inferred from estimate
 * ordering can certify settings the request never contained (cross-topic
 * overwrite dropped an estimate to the report + tail). A witness is never
 * overwritten while its request is in flight except by a re-dispatch of the
 * SAME assistant row (overflow retry / continuation), which replaces it with
 * the new request's state. Bounded map; oldest evicted.
 */
const anchorRequestWitnesses = new Map<string, AnchorRequestWitness>();
const ANCHOR_REQUEST_WITNESS_LIMIT = 100;

/**
 * Record the dispatch-time witness for a request. Called by the send/retry/
 * continuation paths with the exact state the request was assembled from:
 * the pending assistant id, its parent row, the conversation key, the fixed
 * overhead (chars/2, `estimateFixedContextOverheadTokens`) and the full
 * conversation message list. The fingerprint covers all rows through the
 * parent (content-edit detection). `selectedPrefixIds` is the subset of that
 * prefix the request actually included; omit it to treat the full prefix as
 * selected. When the parent row is not visible in `messages` (store not yet
 * refreshed), no witness is recorded — the report then falls back to the
 * whole-window estimate, which is the safe default for an unverifiable
 * association.
 */
export const recordAnchorRequestWitness = ({
  assistantMessageId,
  conversationKey,
  fixedOverheadTokens,
  inputTemplate,
  messages,
  parentMessageId,
  selectedPrefixIds,
}: {
  assistantMessageId: string;
  conversationKey: string;
  fixedOverheadTokens: number;
  /** Frozen `chatConfig.inputTemplate` from the sent request; omitted stores ''. */
  inputTemplate?: string;
  messages: Array<{ content?: unknown; id?: string; updatedAt?: unknown }>;
  parentMessageId?: string;
  selectedPrefixIds?: string[];
}) => {
  if (!assistantMessageId) return;
  const parentIndex = parentMessageId
    ? messages.findIndex(({ id }) => id === parentMessageId)
    : -1;
  if (parentMessageId && parentIndex < 0) return;
  const prefix = parentIndex >= 0 ? messages.slice(0, parentIndex + 1) : [];
  const recordedSelectedPrefixIds =
    selectedPrefixIds ??
    prefix.map((message) => message.id).filter((id): id is string => !!id);

  // Re-dispatch of the same row (overflow retry / continuation) replaces the
  // witness: the next report answers the LATEST request, not the original.
  anchorRequestWitnesses.delete(assistantMessageId);
  anchorRequestWitnesses.set(assistantMessageId, {
    conversationKey,
    fixedOverheadTokens,
    inputTemplate: normalizeAnchorInputTemplate(inputTemplate),
    parentMessageId,
    prefixFingerprint: fingerprintAnchorPrefix(prefix),
    selectedPrefixIds: recordedSelectedPrefixIds,
  });
  while (anchorRequestWitnesses.size > ANCHOR_REQUEST_WITNESS_LIMIT) {
    const oldest = anchorRequestWitnesses.keys().next().value;
    if (oldest === undefined) break;
    anchorRequestWitnesses.delete(oldest);
  }
};

/** Test support: drop all retained baselines/witnesses (module state survives across tests in a file). */
export const clearAnchorBaselines = () => {
  anchorBaselines.clear();
  anchorRequestWitnesses.clear();
};

const floorOverheadDelta = (
  overheadDelta: number,
  currentFixedOverheadTokens: number,
  reportedInputTokens: number,
) =>
  overheadDelta < 0
    ? Math.max(overheadDelta, currentFixedOverheadTokens - reportedInputTokens)
    : overheadDelta;

/**
 * Resolve the anchor's retained baseline, or `undefined` when the caller must
 * fall back to the whole-window estimate. Three cases:
 * - Known baseline, matching prefix: trust, adding the fixed-overhead delta,
 *   unless the current selected window includes pre-anchor rows the original
 *   request did not (U2), or the input template applied to those user rows
 *   changed (U3).
 * - Known baseline, mismatched prefix (R3): fall back permanently — the report
 *   covered the ORIGINAL prefix, so re-baselining onto an edited prefix would
 *   re-trust a report that never counted those messages. The anchor stays
 *   invalid until a fresh provider report arrives under a new anchor id.
 * - No baseline (D2/T1): fall back unless a dispatch-time witness exists for
 *   THIS anchor id in THIS conversation whose parent row and prefix
 *   fingerprint still match exactly. The witness proves the report answers
 *   the request this process dispatched with that exact prefix and overhead;
 *   on promotion the witness is consumed and becomes the baseline.
 * The returned delta is floored so the anchored total can never drop below
 * what the next request minimally contains (current overhead + tail).
 */
export const resolveAnchorBaseline = ({
  anchorId,
  anchorParentId,
  conversationKey,
  currentFixedOverheadTokens,
  inputTemplate,
  prefixFingerprint,
  reportedInputTokens,
  selectedPrefixIds,
}: {
  anchorId: string;
  anchorParentId?: string;
  conversationKey: string;
  currentFixedOverheadTokens: number;
  /** Current input template; omitted skips the U3 template check. */
  inputTemplate?: string;
  prefixFingerprint: string;
  reportedInputTokens: number;
  /** Currently selected pre-anchor ids; omitted skips the U2 grow check. */
  selectedPrefixIds?: string[];
}): { overheadDelta: number } | undefined => {
  const cached = anchorBaselines.get(anchorId);
  if (cached) {
    if (
      cached.prefixFingerprint !== prefixFingerprint ||
      selectionIncludesUnsentPrefix(cached.selectedPrefixIds, selectedPrefixIds) ||
      inputTemplateChanged(cached.inputTemplate, inputTemplate)
    ) {
      return undefined;
    }
    return {
      overheadDelta: floorOverheadDelta(
        currentFixedOverheadTokens - cached.fixedOverheadTokens,
        currentFixedOverheadTokens,
        reportedInputTokens,
      ),
    };
  }

  const witness = anchorRequestWitnesses.get(anchorId);
  if (
    !witness ||
    witness.conversationKey !== conversationKey ||
    witness.parentMessageId !== anchorParentId ||
    witness.prefixFingerprint !== prefixFingerprint ||
    selectionIncludesUnsentPrefix(witness.selectedPrefixIds, selectedPrefixIds) ||
    inputTemplateChanged(witness.inputTemplate, inputTemplate)
  ) {
    return undefined;
  }
  // One-shot: the baseline registry owns the anchor from here on.
  anchorRequestWitnesses.delete(anchorId);
  registerAnchorBaseline(anchorId, {
    fixedOverheadTokens: witness.fixedOverheadTokens,
    inputTemplate: witness.inputTemplate,
    prefixFingerprint,
    selectedPrefixIds: witness.selectedPrefixIds,
  });
  return {
    overheadDelta: floorOverheadDelta(
      currentFixedOverheadTokens - witness.fixedOverheadTokens,
      currentFixedOverheadTokens,
      reportedInputTokens,
    ),
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
