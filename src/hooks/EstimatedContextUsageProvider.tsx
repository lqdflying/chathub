'use client';

import { createContext, useContext, type ReactNode } from 'react';

import {
  type EstimatedContextConversationSource,
  type EstimatedContextUsage,
  useEstimatedContextUsage,
} from '@/hooks/useEstimatedContextUsage';

export interface EstimatedContextUsageValue extends EstimatedContextUsage {
  conversationSource: EstimatedContextConversationSource;
}

const EMPTY_HISTORY_WINDOW = {
  configuredHistoryCount: 0,
  effectiveHistoryCount: 0,
  enableHistoryCount: false,
  excludedByCursor: 0,
  excludedByHistoryCount: 0,
  expanded: false,
  hasTopicSummary: false,
  includedMessageCount: 0,
  topicMessageCount: 0,
  warnUncoveredExclusion: false,
};

export const EMPTY_ESTIMATED_CONTEXT_USAGE: EstimatedContextUsageValue = {
  chatInstructionToken: 0,
  chatsToken: 0,
  conversationSource: 'main',
  historySummaryToken: 0,
  historyWindow: EMPTY_HISTORY_WINDOW,
  inputTokenCount: 0,
  knowledgeBaseToken: 0,
  maxTokens: 0,
  memoryToken: 0,
  ratio: 0,
  roleSettingsToken: 0,
  systemRoleToken: 0,
  toolsToken: 0,
  topicChatsToken: 0,
  totalToken: 0,
};

const EstimatedContextUsageContext = createContext<EstimatedContextUsageValue | null>(null);

export const EstimatedContextUsageProvider = ({
  children,
  conversationSource = 'main',
}: {
  children: ReactNode;
  conversationSource?: EstimatedContextConversationSource;
}) => {
  const usage = useEstimatedContextUsage(conversationSource);

  return (
    <EstimatedContextUsageContext.Provider value={{ ...usage, conversationSource }}>
      {children}
    </EstimatedContextUsageContext.Provider>
  );
};

export const useEstimatedContextUsageContext = () => useContext(EstimatedContextUsageContext);

/** Reads the shared provider. Does not run a second tokenizer. */
export const useLiveEstimatedContextUsage = (
  conversationSource: EstimatedContextConversationSource = 'main',
): EstimatedContextUsage => {
  const value = useContext(EstimatedContextUsageContext);
  if (value && value.conversationSource === conversationSource) return value;
  return EMPTY_ESTIMATED_CONTEXT_USAGE;
};
