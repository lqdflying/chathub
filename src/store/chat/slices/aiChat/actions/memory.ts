import { chainSummaryHistory } from '@lobechat/prompts';
import { SummaryHistoryOptions, TraceNameMap, UIChatMessage } from '@lobechat/types';
import { StateCreator } from 'zustand/vanilla';

import { estimateContextUsageAsync } from '@/helpers/estimateContextUsageAsync';
import { chatService } from '@/services/chat';
import { topicService } from '@/services/topic';
import { getAgentStoreState } from '@/store/agent/store';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
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

export const chatMemory: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatMemoryAction
> = (set, get) => ({
  internal_summaryHistory: async (messages, options) => {
    const topicId = get().activeTopicId;
    if (messages.length <= 1 || !topicId) return;

    const trigger = options?.trigger ?? 'message_count';

    const { model, provider } = systemAgentSelectors.historyCompress(useUserStore.getState());

    let estimatedTokensBefore = options?.estimatedTokensBefore;
    if (estimatedTokensBefore === undefined) {
      const est = await estimateContextUsageAsync({
        agentState: getAgentStoreState(),
        chatState: get(),
      });
      estimatedTokensBefore = est.totalToken;
    }

    let historySummary = '';
    await chatService.fetchPresetTaskResult({
      onFinish: async (text) => {
        historySummary = text;
      },
      params: { ...chainSummaryHistory(messages), model, provider, stream: false },
      trace: {
        sessionId: get().activeId,
        topicId: get().activeTopicId,
        traceName: TraceNameMap.SummaryHistoryMessages,
      },
    });

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
    await get().refreshTopic();
    await get().refreshMessages();

    const afterEst = await estimateContextUsageAsync({
      agentState: getAgentStoreState(),
      chatState: get(),
    });

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
    await get().refreshTopic();
  },

  triggerManualMemoryCompaction: async () => {
    await runCompactionFromStore(get, 'manual');
  },

  triggerScheduledMemoryCompaction: async () => {
    await runCompactionFromStore(get, 'scheduled');
  },

  triggerTokenThresholdMemoryCompaction: async () => {
    await runCompactionFromStore(get, 'token_threshold');
  },
});

const runCompactionFromStore = async (
  get: () => ChatStore,
  trigger: 'manual' | 'scheduled' | 'token_threshold',
) => {
  const state = get();
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

  await get().internal_summaryHistory(historyMessages, {
    estimatedTokensBefore: est.totalToken,
    trigger,
  });
};
