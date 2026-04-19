'use client';

import { useEffect, useRef } from 'react';

import { estimateContextUsageAsync } from '@/helpers/estimateContextUsageAsync';
import { getModelContextWindowTokens } from '@/helpers/modelContextWindowTokens';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { getChatStoreState } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

const COOLDOWN_MS = 90_000;
const CHECK_INTERVAL_MS = 4000;

const ContextAutoCompactWatcher = () => {
  const fingerprint = useAgentStore((s) => {
    const cfg = agentChatConfigSelectors.currentChatConfig(s);
    return [
      agentSelectors.currentAgentModel(s),
      agentSelectors.currentAgentModelProvider(s),
      cfg.enableTokenThresholdAutoCompact,
      cfg.contextCompactThreshold,
      cfg.enableHistoryCount,
      cfg.enableCompressHistory,
      cfg.historyCount,
    ].join('|');
  });

  const lastRunRef = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const chat = getChatStoreState();
      const agent = getAgentStoreState();
      const cfg = agentChatConfigSelectors.currentChatConfig(agent);

      if (!cfg.enableTokenThresholdAutoCompact) return;
      if (!chat.activeTopicId || chat.isCreatingMessage) return;
      if (chatSelectors.isAIGenerating(chat)) return;
      if (!cfg.enableHistoryCount || !cfg.enableCompressHistory) return;

      const model = agentSelectors.currentAgentModel(agent) as string;
      const provider = agentSelectors.currentAgentModelProvider(agent) as string;
      const maxTokens = getModelContextWindowTokens(model, provider);
      if (!maxTokens) return;

      const { totalToken } = await estimateContextUsageAsync({ agentState: agent, chatState: chat });
      const threshold = cfg.contextCompactThreshold ?? 0.8;
      if (totalToken / maxTokens < threshold) return;

      const now = Date.now();
      if (now - lastRunRef.current < COOLDOWN_MS) return;

      lastRunRef.current = now;
      await chat.triggerTokenThresholdMemoryCompaction?.();
    }, CHECK_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [fingerprint]);

  return null;
};

export default ContextAutoCompactWatcher;
