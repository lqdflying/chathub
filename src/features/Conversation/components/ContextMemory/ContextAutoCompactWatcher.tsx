'use client';

import type { UIChatMessage } from '@lobechat/types';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  createCompactionFingerprint,
  getContextCompactionWatermarks,
} from '@/helpers/contextCompaction';
import { useEstimatedContextUsage } from '@/hooks/useEstimatedContextUsage';
import { logCompactionWatcherArmed } from '@/libs/logger/compactionDebugClient';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { isGroupSessionContext } from './isGroupSessionContext';

const EMPTY_TOPIC_MESSAGES: UIChatMessage[] = [];

const conversationStoreEqual = (
  a: {
    activeThreadId?: string | null;
    cursorId?: string;
    generating: boolean;
    group: boolean;
    isCreatingMessage: boolean;
    messages?: UIChatMessage[];
    portalThreadId?: string | null;
    sessionId?: string | null;
    summary?: string;
    topicId?: string | null;
  },
  b: typeof a,
) =>
  a.messages === b.messages &&
  a.cursorId === b.cursorId &&
  a.summary === b.summary &&
  a.sessionId === b.sessionId &&
  a.topicId === b.topicId &&
  a.activeThreadId === b.activeThreadId &&
  a.portalThreadId === b.portalThreadId &&
  a.generating === b.generating &&
  a.group === b.group &&
  a.isCreatingMessage === b.isCreatingMessage;

const COMPACTION_DEBOUNCE_MS = 750;
/** After a failed auto-compact, re-arm once the same high-water state persists. */
const COMPACTION_FAILED_RETRY_MS = 10_000;

const ContextAutoCompactWatcher = () => {
  const { knowledgeBaseToken, maxTokens, ratio, totalToken } = useEstimatedContextUsage();
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

    return {
      activeThreadId: state.activeThreadId,
      cursorId: topic?.metadata?.historySummaryLastMessageId,
      generating: chatSelectors.isAIGenerating(state),
      group: isGroupSessionContext(state.activeSessionType),
      isCreatingMessage: state.isCreatingMessage,
      messages: state.activeId
        ? state.messagesMap[messageMapKey(state.activeId, state.activeTopicId)]
        : EMPTY_TOPIC_MESSAGES,
      portalThreadId: state.portalThreadId,
      sessionId: state.activeId,
      summary: topic?.historySummary,
      topicId: state.activeTopicId,
    };
  }, conversationStoreEqual);
  const topicMessages = useMemo(
    () => (conversation.messages ?? EMPTY_TOPIC_MESSAGES).filter((message) => !message.threadId),
    [conversation.messages],
  );
  const messageFingerprint = useMemo(
    () =>
      createCompactionFingerprint({
        cursorId: conversation.cursorId,
        messages: topicMessages,
        summary: conversation.summary,
      }),
    [conversation.cursorId, conversation.summary, topicMessages],
  );
  const lastAttemptRef = useRef('');
  const [retryTick, setRetryTick] = useState(0);

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
      messageFingerprint,
      totalToken,
      maxTokens,
      config.highWatermark,
    ].join('|');
    if (lastAttemptRef.current === attemptFingerprint) return;

    let cancelled = false;
    let retryTimer: number | undefined;

    const timer = window.setTimeout(() => {
      lastAttemptRef.current = attemptFingerprint;
      void logCompactionWatcherArmed({
        highWatermark: config.highWatermark,
        knowledgeBaseToken,
        maxTokens,
        ratio,
        sessionId: conversation.sessionId,
        topicId: conversation.topicId,
        totalToken,
      });
      void useChatStore
        .getState()
        .triggerTokenThresholdMemoryCompaction()
        .then((result) => {
          if (cancelled) return;
          if (result.status === 'failed') {
            // Allow the same fingerprint to re-arm after backoff (server can
            // now create a new job after retiring a failed idempotency key).
            lastAttemptRef.current = '';
            retryTimer = window.setTimeout(() => {
              if (!cancelled) setRetryTick((tick) => tick + 1);
            }, COMPACTION_FAILED_RETRY_MS);
          }
        })
        .catch((error) => {
          console.error(error);
          if (cancelled) return;
          lastAttemptRef.current = '';
          retryTimer = window.setTimeout(() => {
            if (!cancelled) setRetryTick((tick) => tick + 1);
          }, COMPACTION_FAILED_RETRY_MS);
        });
    }, COMPACTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [
    config,
    conversation,
    knowledgeBaseToken,
    maxTokens,
    messageFingerprint,
    ratio,
    retryTick,
    totalToken,
  ]);

  return null;
};

export default ContextAutoCompactWatcher;
