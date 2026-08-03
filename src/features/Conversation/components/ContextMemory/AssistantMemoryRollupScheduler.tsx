'use client';

import { useEffect } from 'react';

import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { getChatStoreState } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { isGroupSessionContext } from './isGroupSessionContext';

const CHECK_MS = 120_000;

const rollupKey = (userScope: string, agentId: string) =>
  `lobe_assistant_memory_rollup_${userScope}_${agentId}`;

/** Local calendar day, matching the "once per calendar day" copy of the setting. */
const todayLocal = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const AssistantMemoryRollupScheduler = () => {
  useEffect(() => {
    // every guard reads live state inside the tick, so the interval never resets on
    // agent/config switches — users who switch chats often still get their daily rollup
    const timer = window.setInterval(async () => {
      const chat = getChatStoreState();
      const agent = getAgentStoreState();
      const cfg = agentChatConfigSelectors.currentChatConfig(agent);

      if (cfg.enableAssistantMemory === false) return;
      if (!cfg.enablePeriodicAssistantMemoryRollup) return;
      if (!agent.activeAgentId || !chat.activeId) return;
      if (isGroupSessionContext(chat.activeSessionType)) return;
      if (chatSelectors.isAIGenerating(chat)) return;

      const userScope = authSelectors.currentUserScope(useUserStore.getState());
      // auth state not resolved yet — skip so the marker isn't written under 'anon'
      // and again under 'user:<id>' the same day
      if (!userScope) return;

      const key = rollupKey(userScope, agent.activeAgentId);
      const day = todayLocal();
      let stored = '';
      try {
        stored = localStorage.getItem(key) || '';
      } catch {
        return;
      }

      if (stored === day) return;

      const result = await agent
        .rollupAssistantMemory?.({ trigger: 'scheduled' })
        .catch(() => undefined);

      // done for today on success or a genuine no-op skip; a failure leaves the marker
      // unwritten (the action's error backoff paces retries), and a backoff skip keeps
      // the marker unwritten too so the retry can still happen later today
      const doneForToday =
        result?.status === 'success' ||
        (result?.status === 'skipped' && result.reason !== 'backoff');
      if (!doneForToday) return;

      try {
        localStorage.setItem(key, day);
      } catch {
        /* ignore */
      }
    }, CHECK_MS);

    return () => window.clearInterval(timer);
  }, []);

  return null;
};

export default AssistantMemoryRollupScheduler;
