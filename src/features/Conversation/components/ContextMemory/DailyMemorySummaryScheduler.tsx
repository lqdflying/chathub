'use client';

import { useEffect } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { getChatStoreState } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

const CHECK_MS = 120_000;

const dailyKey = (sessionId: string | null, topicId: string | null | undefined) =>
  `lobe_daily_memory_${sessionId ?? 'none'}_${topicId ?? 'none'}`;

const todayUtc = () => new Date().toISOString().slice(0, 10);

const DailyMemorySummaryScheduler = () => {
  const fingerprint = useAgentStore((s) => {
    const cfg = agentChatConfigSelectors.currentChatConfig(s);
    return [cfg.enableDailyMemorySummary, cfg.enableHistoryCount, cfg.enableCompressHistory].join(
      '|',
    );
  });

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const chat = getChatStoreState();
      const agent = getAgentStoreState();
      const cfg = agentChatConfigSelectors.currentChatConfig(agent);

      if (!cfg.enableDailyMemorySummary) return;
      if (!chat.activeTopicId || !chat.activeId) return;
      if (chat.activeSessionType === 'group' || chat.activeThreadId || chat.portalThreadId) return;
      if (!agentChatConfigSelectors.enableHistoryCount(agent) || !cfg.enableCompressHistory) return;
      if (chatSelectors.isAIGenerating(chat)) return;

      const key = dailyKey(chat.activeId, chat.activeTopicId);
      const day = todayUtc();
      let stored = '';
      try {
        stored = localStorage.getItem(key) || '';
      } catch {
        return;
      }

      if (stored === day) return;

      const result = await chat.triggerScheduledMemoryCompaction?.();
      if (!result || result.status === 'failed' || result.status === 'ineligible') return;

      try {
        localStorage.setItem(key, day);
      } catch {
        /* ignore */
      }
    }, CHECK_MS);

    return () => window.clearInterval(timer);
  }, [fingerprint]);

  return null;
};

export default DailyMemorySummaryScheduler;
