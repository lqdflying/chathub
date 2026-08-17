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
  getContextCompactionWatermarks,
  getSettledCompactionPrefixes,
  resolvePendingCompactionHistory,
  selectDefaultCompactionPrefix,
  splitCompactionBatches,
} from '@/helpers/contextCompaction';
import { estimateContextUsageAsync } from '@/helpers/estimateContextUsageAsync';
import { getModelContextWindowTokens } from '@/helpers/modelContextWindowTokens';
import { chatService } from '@/services/chat';
import { tryEnqueueConversationGeneration } from '@/services/conversationGeneration';
import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
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
      max_tokens: CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
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
  const isCurrentRequest = () =>
    isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
    get().conversationClearGeneration === requestedGeneration &&
    get().memoryCompactionInvalidationGeneration === requestedInvalidationGeneration &&
    get().activeId === requestedSessionId &&
    get().activeTopicId === requestedTopicId;

  if (!requestedSessionId || !requestedTopicId || !isCurrentRequest()) {
    return compactionResult('ineligible', { reason: 'no_active_topic' });
  }
  if (!isRegularTopicCompaction(state)) {
    return compactionResult('ineligible', { reason: 'threads_and_groups_are_not_supported' });
  }
  if (chatSelectors.isAIGenerating(state)) {
    return compactionResult('ineligible', { reason: 'generation_in_progress' });
  }

  const agentState = getAgentStoreState();
  const chatConfig = agentChatConfigSelectors.currentChatConfig(agentState);
  const enableHistoryCount = agentChatConfigSelectors.enableHistoryCount(agentState);
  const historyCount = agentChatConfigSelectors.historyCount(agentState);

  if (!enableHistoryCount || !chatConfig.enableCompressHistory) {
    return compactionResult('ineligible', { reason: 'history_compaction_is_disabled' });
  }
  if (trigger === 'token_threshold' && !chatConfig.enableTokenThresholdAutoCompact) {
    return compactionResult('ineligible', { reason: 'token_auto_compaction_is_disabled' });
  }

  const topic = topicSelectors.currentActiveTopic(state);
  if (!topic) return compactionResult('ineligible', { reason: 'topic_not_loaded' });

  const mainMessages = chatSelectors.mainTopicAIChats(state);
  const pending = resolvePendingCompactionHistory({
    cursorId: topic.metadata?.historySummaryLastMessageId,
    historySummary: topic.historySummary,
    messages: mainMessages,
  });
  const { high, low } = getContextCompactionWatermarks(chatConfig.contextCompactThreshold);
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
      return compactionResult('not_needed', {
        highWatermark: high,
        lowWatermark: low,
        reason: 'no_settled_turn_available',
      });
    }
  }

  const beforeEstimate = await estimateContextUsageAsync({ agentState, chatState: state });
  if (abortController?.signal.aborted) {
    return compactionResult('ineligible', { reason: 'aborted' });
  }
  if (!isCurrentRequest())
    return compactionResult('ineligible', { reason: 'conversation_changed' });

  const { model: chatModel, provider: chatProvider } =
    // The history compression model is used only for the summarizer; the active model owns watermarks.
    systemAgentSelectors.historyCompress(useUserStore.getState());
  const { model: activeModel, provider: activeProvider } =
    agentSelectors.currentAgentConfig(agentState);
  const maxTokens = getModelContextWindowTokens(activeModel, activeProvider);

  if (trigger === 'token_threshold') {
    if (!maxTokens) {
      return compactionResult('ineligible', { reason: 'unknown_context_window' });
    }
    if (beforeEstimate.totalToken / maxTokens < high) {
      return compactionResult('not_needed', {
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
      return compactionResult('ineligible', { reason: 'aborted' });
    }
    candidateMessages = selected.messages;
    targetReachable = selected.targetReachable;
  }

  if (pending.rebuildingSummary) {
    candidateMessages = getSettledCompactionPrefixes(pending.pendingMessages).at(-1) ?? [];
  }

  if (!candidateMessages.length) {
    return compactionResult(trigger === 'token_threshold' ? 'target_unreachable' : 'not_needed', {
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

  if (
    isClientDurableConversationGenerationEnabled() &&
    !abortController &&
    chatModel &&
    chatProvider
  ) {
    const operation = await tryEnqueueConversationGeneration({
      config: {
        historySummary: pending.previousSummary,
        model: chatModel,
        provider: chatProvider,
      },
      kind: 'memory_compaction',
      replaceActive: true,
      sessionId: requestedSessionId,
      topicId: requestedTopicId,
    });
    if (operation) {
      get().attachConversationGeneration({
        generation: requestedGeneration,
        operationId: operation.id,
        sessionId: requestedSessionId,
        topicId: requestedTopicId,
        userScope: accountMutationSnapshot.scope,
      });
      return compactionResult('ineligible', { reason: 'durable_enqueued' });
    }
  }

  for (const batch of processedBatches) {
    if (abortController?.signal.aborted) {
      return compactionResult('ineligible', { reason: 'aborted' });
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
      return compactionResult('ineligible', { reason: 'aborted' });
    }
    if (!isCurrentRequest()) {
      return compactionResult('ineligible', { reason: 'conversation_changed' });
    }
    if (!nextSummary) {
      // fetchPresetTaskResult resolves without onFinish/onError when the request is
      // aborted — a user Stop is not a summarizer failure
      if (abortController?.signal.aborted) {
        return compactionResult('ineligible', { reason: 'aborted' });
      }
      return compactionResult('failed', {
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
    return compactionResult('ineligible', { reason: 'aborted' });
  }
  if (!isCurrentRequest())
    return compactionResult('ineligible', { reason: 'conversation_changed' });

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
    return compactionResult('ineligible', { reason: 'aborted' });
  }
  if (!isCurrentRequest())
    return compactionResult('ineligible', { reason: 'conversation_changed' });

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
    return compactionResult('ineligible', { reason: 'conversation_changed' });
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
    return compactionResult('ineligible', { reason: 'aborted' });
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

  return compactionResult(status, {
    estimatedTokensAfter: afterEstimate.totalToken,
    estimatedTokensBefore: beforeEstimate.totalToken,
    highWatermark: high,
    lowWatermark: low,
    messageCountIncluded: processedMessages.length,
    reason,
  });
}

const triggerCompaction = async (
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

  const job = runCompactionFromStore(get, trigger, accountMutationSnapshot, abortController).catch(
    () => compactionResult('failed', { reason: 'compaction_exception' }),
  );
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
> = (_set, get) => ({
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

    _set(
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

  triggerManualMemoryCompaction: () => triggerCompaction(get, 'manual'),
  triggerMessageCountMemoryCompaction: () => triggerCompaction(get, 'message_count'),
  triggerScheduledMemoryCompaction: () => triggerCompaction(get, 'scheduled'),
  triggerTokenThresholdMemoryCompaction: (abortController) =>
    triggerCompaction(get, 'token_threshold', abortController),
});
