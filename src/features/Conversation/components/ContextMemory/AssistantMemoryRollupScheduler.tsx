'use client';

import { useEffect } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { getChatStoreState } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

import { isGroupSessionContext } from './isGroupSessionContext';

const CHECK_MS = 120_000;

const rollupKey = (agentId: string | null | undefined) =>
  `lobe_assistant_memory_rollup_${agentId ?? 'none'}`;

const todayUtc = () => new Date().toISOString().slice(0, 10);

const AssistantMemoryRollupScheduler = () => {
  const fingerprint = useAgentStore((s) => {
    const cfg = agentChatConfigSelectors.currentChatConfig(s);
    return [cfg.enablePeriodicAssistantMemoryRollup, s.activeAgentId].join('|');
  });

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const chat = getChatStoreState();
      const agent = getAgentStoreState();
      const cfg = agentChatConfigSelectors.currentChatConfig(agent);

      if (!cfg.enablePeriodicAssistantMemoryRollup) return;
      if (!agent.activeAgentId || !chat.activeId) return;
      if (isGroupSessionContext(chat.activeSessionType)) return;
      if (chatSelectors.isAIGenerating(chat)) return;

      const key = rollupKey(agent.activeAgentId);
      const day = todayUtc();
      let stored = '';
      try {
        stored = localStorage.getItem(key) || '';
      } catch {
        return;
      }

      if (stored === day) return;

      const result = await agent.rollupAssistantMemory?.();
      if (!result?.success) return;

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

export default AssistantMemoryRollupScheduler;
