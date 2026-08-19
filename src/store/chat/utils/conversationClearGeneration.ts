import type { ChatStore } from '@/store/chat/store';

import { messageMapKey } from './messageMapKey';

export const resolveConversationClearGeneration = (
  state: Pick<ChatStore, 'conversationClearGeneration' | 'conversationScopedClearGenerations'>,
  sessionId?: string | null,
  topicId?: string | null,
) => {
  if (!sessionId) return state.conversationClearGeneration;

  const scoped =
    state.conversationScopedClearGenerations[messageMapKey(sessionId, topicId)] ?? 0;
  return Math.max(state.conversationClearGeneration, scoped);
};

export const bumpScopedConversationClearGeneration = (
  state: Pick<ChatStore, 'conversationClearGeneration' | 'conversationScopedClearGenerations'>,
  sessionId: string,
  topicId?: string | null,
) => {
  const scopedKey = messageMapKey(sessionId, topicId);
  const nextScoped = resolveConversationClearGeneration(state, sessionId, topicId) + 1;

  return {
    conversationScopedClearGenerations: {
      ...state.conversationScopedClearGenerations,
      [scopedKey]: nextScoped,
    },
  };
};
