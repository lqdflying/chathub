'use client';

import { useEffect, useRef } from 'react';

import {
  createCompactionFingerprint,
  getContextCompactionWatermarks,
} from '@/helpers/contextCompaction';
import { useEstimatedContextUsage } from '@/hooks/useEstimatedContextUsage';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';

import { isGroupSessionContext } from './isGroupSessionContext';

const COMPACTION_DEBOUNCE_MS = 750;

const ContextAutoCompactWatcher = () => {
  const { maxTokens, ratio, totalToken } = useEstimatedContextUsage();
  const config = useAgentStore((state) => {
    const chatConfig = agentChatConfigSelectors.currentChatConfig(state);
    return {
      enableCompressHistory: !!chatConfig.enableCompressHistory,
      enableHistoryCount: !!agentChatConfigSelectors.enableHistoryCount(state),
      enableTokenThresholdAutoCompact:
        !!agentChatConfigSelectors.enableTokenThresholdAutoCompact(state),
      highWatermark: getContextCompactionWatermarks(
        agentChatConfigSelectors.contextCompactThreshold(state),
      ).high,
    };
  });
  const conversation = useChatStore((state) => {
    const topic = topicSelectors.currentActiveTopic(state);
    const messages = chatSelectors.mainTopicAIChats(state);

    return {
      activeThreadId: state.activeThreadId,
      generating: chatSelectors.isAIGenerating(state),
      group: isGroupSessionContext(state.activeSessionType),
      isCreatingMessage: state.isCreatingMessage,
      messageFingerprint: createCompactionFingerprint({
        cursorId: topic?.metadata?.historySummaryLastMessageId,
        messages,
        summary: topic?.historySummary,
      }),
      portalThreadId: state.portalThreadId,
      sessionId: state.activeId,
      topicId: state.activeTopicId,
    };
  });
  const lastAttemptRef = useRef('');

  useEffect(() => {
    if (!config.enableTokenThresholdAutoCompact) return;
    if (!config.enableHistoryCount || !config.enableCompressHistory) return;
    if (!conversation.sessionId || !conversation.topicId || !maxTokens) return;
    if (
      conversation.group ||
      conversation.activeThreadId ||
      conversation.portalThreadId ||
      conversation.generating ||
      conversation.isCreatingMessage
    ) {
      return;
    }
    if (ratio < config.highWatermark) return;

    const attemptFingerprint = [
      conversation.sessionId,
      conversation.topicId,
      conversation.messageFingerprint,
      totalToken,
      maxTokens,
      config.highWatermark,
    ].join('|');
    if (lastAttemptRef.current === attemptFingerprint) return;

    const timer = window.setTimeout(() => {
      lastAttemptRef.current = attemptFingerprint;
      void useChatStore.getState().triggerTokenThresholdMemoryCompaction().catch(console.error);
    }, COMPACTION_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [config, conversation, maxTokens, ratio, totalToken]);

  return null;
};

export default ContextAutoCompactWatcher;
