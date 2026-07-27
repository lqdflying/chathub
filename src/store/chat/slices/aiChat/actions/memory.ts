import { chainSummaryHistory } from '@lobechat/prompts';
import { SummaryHistoryOptions, TraceNameMap, UIChatMessage } from '@lobechat/types';
import { StateCreator } from 'zustand/vanilla';

import { estimateContextUsageAsync } from '@/helpers/estimateContextUsageAsync';
import { chatService } from '@/services/chat';
import { topicService } from '@/services/topic';
import { getAgentStoreState } from '@/store/agent/store';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import {
  AccountMutationSnapshot,
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import type { ChatStore } from '@/store/chat/store';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

const MAX_MEMORY_DEBUG_LOG = 20;

export interface ChatMemoryAction {
  internal_summaryHistory: (
    messages: UIChatMessage[],
    options?: SummaryHistoryOptions,
  ) => Promise<void>;
  triggerManualMemoryCompaction: () => Promise<void>;
  triggerScheduledMemoryCompaction: () => Promise<void>;
  triggerTokenThresholdMemoryCompaction: () => Promise<void>;
}

async function runCompactionFromStore(
  get: () => ChatStore,
  trigger: 'manual' | 'scheduled' | 'token_threshold',
  accountMutationSnapshot: AccountMutationSnapshot,
) {
  const state = get();
  const requestedGeneration = state.conversationClearGeneration;
  const requestedSessionId = state.activeId;
  const requestedTopicId = state.activeTopicId;
  const isCurrentRequest = () =>
    isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
    get().conversationClearGeneration === requestedGeneration &&
    get().activeId === requestedSessionId &&
    get().activeTopicId === requestedTopicId;
  if (!isCurrentRequest()) return;

  const agentState = getAgentStoreState();
  const chatConfig = agentChatConfigSelectors.currentChatConfig(agentState);
  const historyCount = agentChatConfigSelectors.historyCount(agentState);

  if (!state.activeTopicId) return;
  if (!chatConfig.enableHistoryCount || !chatConfig.enableCompressHistory) return;

  const originalMessages = chatSelectors.mainAIChatsWithHistoryConfig(state);
  if (originalMessages.length <= 1) return;

  let historyMessages: UIChatMessage[];
  if (originalMessages.length > historyCount) {
    historyMessages = originalMessages.slice(0, -historyCount + 1);
  } else if (originalMessages.length > 2) {
    historyMessages = originalMessages.slice(0, -2);
  } else {
    return;
  }

  if (historyMessages.length <= 1) return;

  const est = await estimateContextUsageAsync({
    agentState,
    chatState: state,
  });
  if (!isCurrentRequest()) return;

  await get().internal_summaryHistory(historyMessages, {
    estimatedTokensBefore: est.totalToken,
    trigger,
  });
}

export const chatMemory: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatMemoryAction
> = (set, get) => ({
  internal_summaryHistory: async (messages, options) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const topicId = get().activeTopicId;
    if (messages.length <= 1 || !topicId) return;
    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === topicId;

    const trigger = options?.trigger ?? 'message_count';

    const { model, provider } = systemAgentSelectors.historyCompress(useUserStore.getState());

    let estimatedTokensBefore = options?.estimatedTokensBefore;
    if (estimatedTokensBefore === undefined) {
      const est = await estimateContextUsageAsync({
        agentState: getAgentStoreState(),
        chatState: get(),
      });
      estimatedTokensBefore = est.totalToken;
      if (!isCurrentRequest()) return;
    }

    let historySummary = '';
    await chatService.fetchPresetTaskResult({
      onFinish: async (text) => {
        if (!isCurrentRequest()) return;
        historySummary = text;
      },
      params: { ...chainSummaryHistory(messages), model, provider, stream: false },
      trace: {
        sessionId: get().activeId,
        topicId: get().activeTopicId,
        traceName: TraceNameMap.SummaryHistoryMessages,
      },
    });
    if (!isCurrentRequest()) return;

    const prevTopic = topicSelectors.currentActiveTopic(get());
    const prevMeta = prevTopic?.metadata ?? {};

    await topicService.updateTopic(topicId, {
      historySummary,
      metadata: {
        ...prevMeta,
        model,
        provider,
      },
    });
    if (!isCurrentRequest()) return;
    await get().refreshTopic();
    if (!isCurrentRequest()) return;
    await get().refreshMessages();
    if (!isCurrentRequest()) return;

    const afterEst = await estimateContextUsageAsync({
      agentState: getAgentStoreState(),
      chatState: get(),
    });
    if (!isCurrentRequest()) return;

    const metaAfterRefresh = topicSelectors.currentActiveTopic(get())?.metadata ?? prevMeta;

    const debugEntry = {
      at: Date.now(),
      estimatedTokensAfter: afterEst.totalToken,
      estimatedTokensBefore,
      messageCountIncluded: messages.length,
      model,
      provider,
      trigger,
    };

    const prevLog = metaAfterRefresh.memoryDebugLog ?? [];
    const agentCfg = agentChatConfigSelectors.currentChatConfig(getAgentStoreState());
    const prevArchives = metaAfterRefresh.memoryArchives ?? [];
    const nextArchives =
      agentCfg.enableUserMemoryArchive && historySummary
        ? [
            ...prevArchives.slice(-24),
            {
              at: Date.now(),
              summaryExcerpt: historySummary.slice(0, 600),
              trigger,
            },
          ]
        : prevArchives;

    await topicService.updateTopic(topicId, {
      metadata: {
        ...metaAfterRefresh,
        memoryArchives: nextArchives,
        memoryDebugLog: [...prevLog.slice(-(MAX_MEMORY_DEBUG_LOG - 1)), debugEntry],
        model,
        provider,
      },
    });
    if (isCurrentRequest()) await get().refreshTopic();
  },

  triggerManualMemoryCompaction: async () => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    await runCompactionFromStore(get, 'manual', accountMutationSnapshot);
  },

  triggerScheduledMemoryCompaction: async () => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    await runCompactionFromStore(get, 'scheduled', accountMutationSnapshot);
  },

  triggerTokenThresholdMemoryCompaction: async () => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    await runCompactionFromStore(get, 'token_threshold', accountMutationSnapshot);
  },
});
