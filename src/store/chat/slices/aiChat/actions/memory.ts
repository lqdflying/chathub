import { chainSummaryHistory } from '@lobechat/prompts';
import {
  type ChatTopicMetadata,
  type MemoryCompactionResult,
  type MemoryCompactionTrigger,
  TraceNameMap,
  type UIChatMessage,
} from '@lobechat/types';
import { StateCreator } from 'zustand/vanilla';

import {
  CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
  buildSimpleCompletionSampling,
  createCompactionFingerprint,
  getContextCompactionWatermarks,
  getSettledCompactionPrefixes,
  resolvePendingCompactionHistory,
  selectDefaultCompactionPrefix,
  splitCompactionBatches,
} from '@/helpers/contextCompaction';
import { conversationGenerationIdempotencyKey } from '@/helpers/conversationGenerationIdempotency';
import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
import { estimateContextUsageAsync } from '@/helpers/estimateContextUsageAsync';
import { getModelContextWindowTokens } from '@/helpers/modelContextWindowTokens';
import {
  createCompactionDebugSpanId,
  hashCompactionDebugClientValue,
  logCompactionDebugClientSafe,
} from '@/libs/logger/compactionDebugClient';
import { chatService } from '@/services/chat';
import {
  asConversationGenerationOperation,
  conversationGenerationService,
  tryEnqueueConversationGeneration,
} from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import {
  AccountMutationSnapshot,
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';
import {
  isConversationClearFenceCurrent,
  laneScopedClearKey,
  resolveConversationClearGeneration,
  trackDurableEnqueue,
  untrackDurableEnqueue,
} from '@/store/chat/utils/conversationClearGeneration';
import { globalHelpers } from '@/store/global/helpers';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import { encodeAsync } from '@/utils/tokenizer';

const MAX_MEMORY_DEBUG_LOG = 20;
const MAX_MEMORY_ARCHIVES = 24;
const compactionJobs = new Map<string, Promise<MemoryCompactionResult>>();

const compactionResult = (
  status: MemoryCompactionResult['status'],
  values: Omit<MemoryCompactionResult, 'status'> = {},
): MemoryCompactionResult => ({ status, ...values });

export interface ChatMemoryAction {
  internal_invalidateMemoryCompaction: (messageIds: string[]) => Promise<void>;
  triggerManualMemoryCompaction: () => Promise<MemoryCompactionResult>;
  triggerMessageCountMemoryCompaction: () => Promise<MemoryCompactionResult>;
  triggerScheduledMemoryCompaction: () => Promise<MemoryCompactionResult>;
  triggerTokenThresholdMemoryCompaction: (
    abortController?: AbortController,
  ) => Promise<MemoryCompactionResult>;
}

const countTextTokens = async (text: string) => {
  try {
    return await encodeAsync(text);
  } catch {
    return text.length;
  }
};

const selectTokenTargetPrefix = async ({
  contextMessages,
  estimatedTokensBefore,
  maxTokens,
  pendingMessages,
  previousSummary,
  targetRatio,
}: {
  contextMessages: UIChatMessage[];
  estimatedTokensBefore: number;
  maxTokens: number;
  pendingMessages: UIChatMessage[];
  previousSummary: string;
  targetRatio: number;
}) => {
  const prefixes = getSettledCompactionPrefixes(pendingMessages);
  if (!prefixes.length) return { messages: [] as UIChatMessage[], targetReachable: false };

  const contextMessageIds = new Set(contextMessages.map(({ id }) => id));
  const previousSummaryTokens = await countTextTokens(previousSummary);
  const summaryGrowthAllowance = Math.max(
    0,
    CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS - previousSummaryTokens,
  );
  const targetTokens = maxTokens * targetRatio;

  for (const prefix of prefixes) {
    const removableText = prefix
      .filter(({ id }) => contextMessageIds.has(id))
      .map(({ content }) => content)
      .join('');
    const removableTokens = await countTextTokens(removableText);
    const projectedTokens = estimatedTokensBefore - removableTokens + summaryGrowthAllowance;

    if (projectedTokens <= targetTokens) return { messages: prefix, targetReachable: true };
  }

  return { messages: prefixes.at(-1) ?? [], targetReachable: false };
};

const summarizeBatch = async ({
  abortController,
  messages,
  model,
  previousSummary,
  provider,
  sessionId,
  topicId,
}: {
  abortController?: AbortController;
  messages: UIChatMessage[];
  model: string;
  previousSummary: string;
  provider: string;
  sessionId?: string;
  topicId: string;
}): Promise<string | undefined> => {
  let failed = false;
  let output = '';

  await chatService.fetchPresetTaskResult({
    abortController,
    onError: () => {
      failed = true;
    },
    onFinish: async (text) => {
      output = text;
    },
    params: {
      ...chainSummaryHistory(messages, previousSummary || undefined),
      ...buildSimpleCompletionSampling({
        model,
        provider,
        summaryMaxTokens: CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
      }),
      model,
      provider,
      stream: false,
    },
    trace: {
      sessionId,
      topicId,
      traceName: TraceNameMap.SummaryHistoryMessages,
    },
  });

  const summary = output.trim();
  return failed || !summary ? undefined : summary;
};

const isRegularTopicCompaction = (state: ChatStore) =>
  state.activeSessionType !== 'group' &&
  !state.activeThreadId &&
  !state.portalThreadId &&
  !chatSelectors.mainTopicAIChats(state).some(({ groupId }) => !!groupId);

const MAX_PRE_SEND_BATCHES = 3;

async function runCompactionFromStore(
  set: (partial: (state: ChatStore) => Partial<ChatStore>, replace?: false, name?: string) => void,
  get: () => ChatStore,
  trigger: MemoryCompactionTrigger,
  accountMutationSnapshot: AccountMutationSnapshot,
  abortController?: AbortController,
): Promise<MemoryCompactionResult> {
  const state = get();
  const requestedGeneration = state.conversationClearGeneration;
  const requestedInvalidationGeneration = state.memoryCompactionInvalidationGeneration;
  const requestedSessionId = state.activeId;
  const requestedTopicId = state.activeTopicId;
  // Full clear fence (global + topic tombstone): topic deletion never bumps the
  // global epoch, so only the resolved fence detects it before registration.
  const requestedClearFence = resolveConversationClearGeneration(
    state,
    requestedSessionId,
    requestedTopicId,
    null,
    'memory_compaction',
  );
  const isCurrentRequest = () =>
    isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
    get().conversationClearGeneration === requestedGeneration &&
    get().memoryCompactionInvalidationGeneration === requestedInvalidationGeneration &&
    get().activeId === requestedSessionId &&
    get().activeTopicId === requestedTopicId &&
    isConversationClearFenceCurrent(
      get(),
      requestedClearFence,
      requestedSessionId,
      requestedTopicId,
      null,
      'memory_compaction',
    );

  const debugSpanId = createCompactionDebugSpanId();
  const debug: {
    activeModel?: string;
    activeProvider?: string;
    beforeEstimate?: Awaited<ReturnType<typeof estimateContextUsageAsync>>;
    candidateCount?: number;
    enableCompressHistory?: boolean;
    enableHistoryCount?: boolean;
    enableTokenThresholdAutoCompact?: boolean;
    enableUserMemoryArchive?: boolean;
    highWatermark?: number;
    historyCount?: number;
    lowWatermark?: number;
    maxTokens?: number;
    slicedMessageCount?: number;
    targetReachable?: boolean;
    topicMessageCount?: number;
    truncatedForPreSend?: boolean;
  } = {};

  const finish = async (
    status: MemoryCompactionResult['status'],
    values: Omit<MemoryCompactionResult, 'status'> = {},
  ): Promise<MemoryCompactionResult> => {
    const result = compactionResult(status, values);
    try {
      const [sessionHash, topicHash] = await Promise.all([
        requestedSessionId ? hashCompactionDebugClientValue(requestedSessionId) : undefined,
        requestedTopicId ? hashCompactionDebugClientValue(requestedTopicId) : undefined,
      ]);
      const totalToken = debug.beforeEstimate?.totalToken ?? result.estimatedTokensBefore;
      const maxTokens = debug.maxTokens;
      logCompactionDebugClientSafe('planner_settled', {
        candidateCount: debug.candidateCount,
        chatsToken: debug.beforeEstimate?.chatsToken,
        enableCompressHistory: debug.enableCompressHistory,
        enableHistoryCount: debug.enableHistoryCount,
        enableTokenThresholdAutoCompact: debug.enableTokenThresholdAutoCompact,
        enableUserMemoryArchive: debug.enableUserMemoryArchive,
        highWatermark: debug.highWatermark ?? result.highWatermark,
        historyCount: debug.historyCount,
        historySummaryToken: debug.beforeEstimate?.historySummaryToken,
        inputToken: debug.beforeEstimate?.inputToken,
        lowWatermark: debug.lowWatermark ?? result.lowWatermark,
        maxTokens,
        memoryToken: debug.beforeEstimate?.memoryToken,
        model: debug.activeModel,
        path: abortController
          ? 'pre_send'
          : result.reason === 'durable_enqueued'
            ? 'durable_enqueued'
            : 'client_inline',
        provider: debug.activeProvider,
        ratio:
          typeof maxTokens === 'number' && maxTokens > 0 && typeof totalToken === 'number'
            ? totalToken / maxTokens
            : undefined,
        reason: result.reason,
        sessionHash,
        slicedMessageCount: debug.slicedMessageCount,
        spanId: debugSpanId,
        status: result.status,
        systemRoleToken: debug.beforeEstimate?.systemRoleToken,
        targetReachable: debug.targetReachable,
        toolsToken: debug.beforeEstimate?.toolsToken,
        topicHash,
        topicMessageCount: debug.topicMessageCount,
        totalToken,
        trigger,
        truncatedForPreSend: debug.truncatedForPreSend,
      });
    } catch {
      // Diagnostics must never interrupt compaction.
    }
    return result;
  };

  if (!requestedSessionId || !requestedTopicId || !isCurrentRequest()) {
    return finish('ineligible', { reason: 'no_active_topic' });
  }
  if (!isRegularTopicCompaction(state)) {
    return finish('ineligible', { reason: 'threads_and_groups_are_not_supported' });
  }
  if (chatSelectors.isAIGenerating(state)) {
    return finish('ineligible', { reason: 'generation_in_progress' });
  }

  const agentState = getAgentStoreState();
  const chatConfig = agentChatConfigSelectors.currentChatConfig(agentState);
  const enableHistoryCount = agentChatConfigSelectors.enableHistoryCount(agentState);
  const historyCount = agentChatConfigSelectors.historyCount(agentState);
  debug.enableCompressHistory = !!chatConfig.enableCompressHistory;
  debug.enableHistoryCount = !!enableHistoryCount;
  debug.enableTokenThresholdAutoCompact = !!chatConfig.enableTokenThresholdAutoCompact;
  debug.enableUserMemoryArchive = !!chatConfig.enableUserMemoryArchive;
  debug.historyCount = historyCount;

  if (!enableHistoryCount || !chatConfig.enableCompressHistory) {
    return finish('ineligible', { reason: 'history_compaction_is_disabled' });
  }
  if (trigger === 'token_threshold' && !chatConfig.enableTokenThresholdAutoCompact) {
    return finish('ineligible', { reason: 'token_auto_compaction_is_disabled' });
  }

  const topic = topicSelectors.currentActiveTopic(state);
  if (!topic) return finish('ineligible', { reason: 'topic_not_loaded' });

  const mainMessages = chatSelectors.mainTopicAIChats(state);
  const pending = resolvePendingCompactionHistory({
    cursorId: topic.metadata?.historySummaryLastMessageId,
    historySummary: topic.historySummary,
    messages: mainMessages,
  });
  const { high, low } = getContextCompactionWatermarks(chatConfig.contextCompactThreshold);
  debug.highWatermark = high;
  debug.lowWatermark = low;
  debug.topicMessageCount = mainMessages.length;
  let candidateMessages: UIChatMessage[] = [];
  let targetReachable = true;

  if (trigger !== 'token_threshold') {
    candidateMessages = selectDefaultCompactionPrefix(
      pending.pendingMessages,
      trigger,
      historyCount,
    );
    if (pending.rebuildingSummary) {
      candidateMessages = getSettledCompactionPrefixes(pending.pendingMessages).at(-1) ?? [];
    }
    if (!candidateMessages.length) {
      debug.candidateCount = 0;
      return finish('not_needed', {
        highWatermark: high,
        lowWatermark: low,
        reason: 'no_settled_turn_available',
      });
    }
  }

  const beforeEstimate = await estimateContextUsageAsync({ agentState, chatState: state });
  debug.beforeEstimate = beforeEstimate;
  debug.slicedMessageCount = beforeEstimate.contextMessages.length;
  if (abortController?.signal.aborted) {
    return finish('ineligible', { reason: 'aborted' });
  }
  if (!isCurrentRequest())
    return finish('ineligible', { reason: 'conversation_changed' });

  const { model: chatModel, provider: chatProvider } =
    // The history compression model is used only for the summarizer; the active model owns watermarks.
    systemAgentSelectors.historyCompress(useUserStore.getState());
  const { model: activeModel, provider: activeProvider } =
    agentSelectors.currentAgentConfig(agentState);
  const maxTokens = getModelContextWindowTokens(activeModel, activeProvider);
  debug.activeModel = activeModel;
  debug.activeProvider = activeProvider;
  debug.maxTokens = maxTokens || undefined;

  if (trigger === 'token_threshold') {
    if (!maxTokens) {
      return finish('ineligible', { reason: 'unknown_context_window' });
    }
    if (beforeEstimate.totalToken / maxTokens < high) {
      return finish('not_needed', {
        estimatedTokensBefore: beforeEstimate.totalToken,
        highWatermark: high,
        lowWatermark: low,
        reason: 'below_high_watermark',
      });
    }
  }

  if (trigger === 'token_threshold' && maxTokens) {
    const selected = await selectTokenTargetPrefix({
      contextMessages: beforeEstimate.contextMessages,
      estimatedTokensBefore: beforeEstimate.totalToken,
      maxTokens,
      pendingMessages: pending.pendingMessages,
      previousSummary: pending.previousSummary,
      targetRatio: low,
    });
    if (abortController?.signal.aborted) {
      return finish('ineligible', { reason: 'aborted' });
    }
    candidateMessages = selected.messages;
    targetReachable = selected.targetReachable;
  }

  if (pending.rebuildingSummary) {
    candidateMessages = getSettledCompactionPrefixes(pending.pendingMessages).at(-1) ?? [];
  }

  debug.candidateCount = candidateMessages.length;
  debug.targetReachable = targetReachable;

  if (!candidateMessages.length) {
    return finish(trigger === 'token_threshold' ? 'target_unreachable' : 'not_needed', {
      estimatedTokensBefore: beforeEstimate.totalToken,
      highWatermark: high,
      lowWatermark: low,
      reason: 'no_settled_turn_available',
    });
  }

  let historySummary = pending.previousSummary;
  const batches = splitCompactionBatches(candidateMessages);
  const maxBatches =
    trigger === 'token_threshold' && abortController ? MAX_PRE_SEND_BATCHES : batches.length;
  const processedBatches = batches.slice(0, maxBatches);
  // pre-send runs may process fewer batches than eligible; the cursor and stats below must
  // only cover what was actually summarized, or the skipped batches are lost forever
  const truncatedForPreSend = processedBatches.length < batches.length;
  debug.truncatedForPreSend = truncatedForPreSend;

  if (
    isClientDurableConversationGenerationEnabled() &&
    !abortController &&
    chatModel &&
    chatProvider
  ) {
    const expectedConversationVersion = await messageService.getConversationVersion();
    // A destructive clear/delete may have installed its tombstone while the
    // version lookup was pending — bail before registering the in-flight key so
    // the enqueue never happens after the fence snapshot.
    if (!isCurrentRequest()) {
      return finish('ineligible', { reason: 'stale_request' });
    }
    const compactionFingerprint = createCompactionFingerprint({
      cursorId: topic.metadata?.historySummaryLastMessageId,
      messages: candidateMessages,
      summary: topic.historySummary,
    });
    const compactionIdempotencyKey = conversationGenerationIdempotencyKey(
      'compaction',
      requestedTopicId,
      compactionFingerprint,
    );
    const compactionLaneKey = laneScopedClearKey(requestedSessionId, requestedTopicId, null);
    set(
      (state) =>
        trackDurableEnqueue(state, compactionLaneKey, {
          idempotencyKey: compactionIdempotencyKey,
          kind: 'memory_compaction',
        }),
      false,
      'memoryCompaction/trackDurableEnqueue',
    );
    let enqueueResult: Awaited<ReturnType<typeof tryEnqueueConversationGeneration>> | undefined;
    try {
      enqueueResult = await tryEnqueueConversationGeneration({
        config: {
          compaction: {
            candidateMessageIds: candidateMessages.map(({ id }) => id),
            debugSpanId,
            enableUserMemoryArchive: chatConfig.enableUserMemoryArchive,
            estimatedTokensBefore: beforeEstimate.totalToken,
            expectedCursorId: topic.metadata?.historySummaryLastMessageId,
            expectedFingerprint: compactionFingerprint,
            expectedHistorySummary: topic.historySummary ?? '',
            highWatermark: high,
            lowWatermark: low,
            targetReachable,
            trigger,
          },
          historySummary: pending.previousSummary,
          locale: globalHelpers.getCurrentLanguage(),
          model: chatModel,
          provider: chatProvider,
        },
        conversationVersion: expectedConversationVersion,
        debugSpanId,
        expectedConversationVersion,
        idempotencyKey: compactionIdempotencyKey,
        kind: 'memory_compaction',
        replaceActive: true,
        sessionId: requestedSessionId,
        topicId: requestedTopicId,
      });
    } finally {
      set(
        (state) => untrackDurableEnqueue(state, compactionLaneKey, compactionIdempotencyKey),
        false,
        'memoryCompaction/untrackDurableEnqueue',
      );
    }
    const operation = asConversationGenerationOperation(enqueueResult);
    if (!isCurrentRequest()) {
      // A destructive action landed during the enqueue await. Its tombstone
      // collected the tracked key, but cancel the returned operation eagerly as
      // a second guard instead of leaving a live server job behind.
      if (operation) {
        await conversationGenerationService.cancel(operation.id).catch(() => undefined);
      }
      return finish('ineligible', { reason: 'stale_request' });
    }
    if (operation) {
      get().attachConversationGeneration({
        clearGeneration: requestedClearFence,
        generation: get().conversationNavigationGeneration,
        kind: operation.kind,
        lane: operation.lane,
        laneGeneration: operation.laneGeneration,
        operationId: operation.id,
        revision: operation.revision,
        sessionId: requestedSessionId,
        threadId: operation.threadId || undefined,
        topicId: requestedTopicId,
        userScope: accountMutationSnapshot.scope,
      });
      return finish('ineligible', { reason: 'durable_enqueued' });
    }
  }

  for (const batch of processedBatches) {
    if (abortController?.signal.aborted) {
      return finish('ineligible', { reason: 'aborted' });
    }
    const nextSummary = await summarizeBatch({
      abortController,
      messages: batch,
      model: chatModel,
      previousSummary: historySummary,
      provider: chatProvider,
      sessionId: requestedSessionId,
      topicId: requestedTopicId,
    });
    if (abortController?.signal.aborted) {
      return finish('ineligible', { reason: 'aborted' });
    }
    if (!isCurrentRequest()) {
      return finish('ineligible', { reason: 'conversation_changed' });
    }
    if (!nextSummary) {
      // fetchPresetTaskResult resolves without onFinish/onError when the request is
      // aborted — a user Stop is not a summarizer failure
      if (abortController?.signal.aborted) {
        return finish('ineligible', { reason: 'aborted' });
      }
      return finish('failed', {
        estimatedTokensBefore: beforeEstimate.totalToken,
        highWatermark: high,
        lowWatermark: low,
        reason: 'empty_or_failed_summary',
      });
    }
    historySummary = nextSummary;
  }

  const processedMessages = processedBatches.flat();
  const compactedThroughMessageId = processedMessages.at(-1)!.id;
  const previousHistorySummary = topic.historySummary ?? '';
  const previousMetadata = topic.metadata ?? {};
  const previousArchives = previousMetadata.memoryArchives ?? [];
  const archiveExcerpt = historySummary.slice(0, 600);
  const shouldArchive =
    !!chatConfig.enableUserMemoryArchive &&
    !!archiveExcerpt &&
    !previousArchives.some(({ summaryExcerpt }) => summaryExcerpt === archiveExcerpt);
  const nextArchives = shouldArchive
    ? [
        ...previousArchives.slice(-(MAX_MEMORY_ARCHIVES - 1)),
        { at: Date.now(), summaryExcerpt: archiveExcerpt, trigger },
      ]
    : previousArchives;
  const afterEstimate = await estimateContextUsageAsync({
    agentState,
    chatState: get(),
    overrides: {
      historySummary,
      historySummaryLastMessageId: compactedThroughMessageId,
      memoryArchives: nextArchives,
    },
  });
  if (abortController?.signal.aborted) {
    return finish('ineligible', { reason: 'aborted' });
  }
  if (!isCurrentRequest())
    return finish('ineligible', { reason: 'conversation_changed' });

  const lastEligibleMessageId = getSettledCompactionPrefixes(pending.pendingMessages)
    .at(-1)
    ?.at(-1)?.id;
  const exhaustedEligibleHistory =
    !truncatedForPreSend &&
    (!targetReachable || compactedThroughMessageId === lastEligibleMessageId);
  const status =
    trigger === 'token_threshold' &&
    maxTokens &&
    exhaustedEligibleHistory &&
    afterEstimate.totalToken / maxTokens > low
      ? 'target_unreachable'
      : 'compacted';
  const reason =
    status === 'target_unreachable' ? 'protected_context_exceeds_low_watermark' : undefined;
  const debugEntry = {
    at: Date.now(),
    compactedThroughMessageId,
    estimatedTokensAfter: afterEstimate.totalToken,
    estimatedTokensBefore: beforeEstimate.totalToken,
    highWatermark: high,
    lowWatermark: low,
    messageCountIncluded: processedMessages.length,
    model: chatModel,
    provider: chatProvider,
    reason,
    status,
    trigger,
  } as const;
  const nextMetadata: ChatTopicMetadata = {
    ...previousMetadata,
    historySummaryLastMessageId: compactedThroughMessageId,
    memoryArchives: nextArchives,
    memoryDebugLog: [
      ...(previousMetadata.memoryDebugLog ?? []).slice(-(MAX_MEMORY_DEBUG_LOG - 1)),
      debugEntry,
    ],
    model: chatModel,
    provider: chatProvider,
  };

  // Re-check right before the write to shrink the window where an invalidation
  // (e.g. the user edited/deleted an included message) races this persist.
  if (abortController?.signal.aborted) {
    return finish('ineligible', { reason: 'aborted' });
  }
  if (!isCurrentRequest())
    return finish('ineligible', { reason: 'conversation_changed' });

  await topicService.updateTopic(requestedTopicId, {
    historySummary,
    metadata: nextMetadata,
  });

  // If an invalidation landed while updateTopic was in flight, our summary is now stale on
  // disk. Undo it with the same cleared state internal_invalidateMemoryCompaction writes,
  // so the next run rebuilds instead of trusting a summary tied to a since-changed message.
  const invalidationRacedWrite =
    get().memoryCompactionInvalidationGeneration !== requestedInvalidationGeneration;
  if (invalidationRacedWrite) {
    if (isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot)) {
      await topicService
        .updateTopic(requestedTopicId, {
          historySummary: '',
          metadata: {
            ...nextMetadata,
            historySummaryLastMessageId: undefined,
            memoryArchives: [],
          },
        })
        .catch(console.error);
    }
    return finish('ineligible', { reason: 'conversation_changed' });
  }

  if (abortController?.signal.aborted) {
    if (isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot)) {
      await topicService
        .updateTopic(requestedTopicId, {
          historySummary: previousHistorySummary,
          metadata: previousMetadata,
        })
        .catch(console.error);
    }
    return finish('ineligible', { reason: 'aborted' });
  }

  if (isCurrentRequest()) {
    get().internal_dispatchTopic(
      {
        id: requestedTopicId,
        type: 'updateTopic',
        value: { historySummary, metadata: nextMetadata },
      },
      'memoryCompaction',
    );
  }

  return finish(status, {
    estimatedTokensAfter: afterEstimate.totalToken,
    estimatedTokensBefore: beforeEstimate.totalToken,
    highWatermark: high,
    lowWatermark: low,
    messageCountIncluded: processedMessages.length,
    reason,
  });
}

const triggerCompaction = async (
  set: (partial: (state: ChatStore) => Partial<ChatStore>, replace?: false, name?: string) => void,
  get: () => ChatStore,
  trigger: MemoryCompactionTrigger,
  abortController?: AbortController,
): Promise<MemoryCompactionResult> => {
  const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
  const state = get();
  if (!accountMutationSnapshot || !state.activeId || !state.activeTopicId) {
    return compactionResult('ineligible', { reason: 'no_active_topic' });
  }

  const key = `${accountMutationSnapshot.scope}:${state.activeId}:${state.activeTopicId}`;
  const running = compactionJobs.get(key);
  if (running) {
    // An abortable caller (pre-send) may join a job started without a controller (e.g. the
    // auto-compact watcher). Don't make it await the whole uncapped job — let it bail on
    // abort. The background job keeps running; its writes stay guarded by the generation
    // checks in runCompactionFromStore.
    if (!abortController) return running;
    if (abortController.signal.aborted) {
      return compactionResult('ineligible', { reason: 'aborted' });
    }
    return Promise.race([
      running,
      new Promise<MemoryCompactionResult>((resolve) => {
        abortController.signal.addEventListener(
          'abort',
          () => resolve(compactionResult('ineligible', { reason: 'aborted' })),
          { once: true },
        );
      }),
    ]);
  }

  const job = runCompactionFromStore(
    set,
    get,
    trigger,
    accountMutationSnapshot,
    abortController,
  ).catch(() => compactionResult('failed', { reason: 'compaction_exception' }));
  compactionJobs.set(key, job);
  try {
    return await job;
  } finally {
    if (compactionJobs.get(key) === job) compactionJobs.delete(key);
  }
};

export const chatMemory: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatMemoryAction
> = (set, get) => ({
  internal_invalidateMemoryCompaction: async (messageIds) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const state = get();
    const topicId = state.activeTopicId;
    const sessionId = state.activeId;
    if (!accountMutationSnapshot || !topicId || !sessionId || state.activeSessionType === 'group') {
      return;
    }

    const topic = topicSelectors.currentActiveTopic(state);
    const cursorId = topic?.metadata?.historySummaryLastMessageId;
    if (!topic?.historySummary && !cursorId) return;

    const mainMessages = chatSelectors.mainTopicAIChats(state);
    const cursorIndex = cursorId ? mainMessages.findIndex(({ id }) => id === cursorId) : -1;
    const affectsSummary = messageIds.some((id) => {
      const index = mainMessages.findIndex((message) => message.id === id);
      return index >= 0 && (cursorIndex < 0 || index <= cursorIndex);
    });
    if (!affectsSummary) return;

    set(
      (s) => ({
        memoryCompactionInvalidationGeneration: s.memoryCompactionInvalidationGeneration + 1,
      }),
      false,
      'invalidateMemoryCompaction/bumpGeneration',
    );

    const metadata: ChatTopicMetadata = {
      ...topic.metadata,
      historySummaryLastMessageId: undefined,
      memoryArchives: [],
    };
    await topicService.updateTopic(topicId, { historySummary: '', metadata });

    if (
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().activeId === sessionId &&
      get().activeTopicId === topicId
    ) {
      get().internal_dispatchTopic(
        { id: topicId, type: 'updateTopic', value: { historySummary: '', metadata } },
        'invalidateMemoryCompaction',
      );
    }
  },

  triggerManualMemoryCompaction: () => triggerCompaction(set, get, 'manual'),
  triggerMessageCountMemoryCompaction: () => triggerCompaction(set, get, 'message_count'),
  triggerScheduledMemoryCompaction: () => triggerCompaction(set, get, 'scheduled'),
  triggerTokenThresholdMemoryCompaction: (abortController) =>
    triggerCompaction(set, get, 'token_threshold', abortController),
});
