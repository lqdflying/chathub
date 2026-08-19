import type { ChatStore } from '@/store/chat/store';

import { messageMapKey } from './messageMapKey';

const topicScopedClearKey = (sessionId: string, topicId?: string | null) =>
  messageMapKey(sessionId, topicId);

const laneScopedClearKey = (
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
) => `${messageMapKey(sessionId, topicId)}:${threadId ?? 'main'}`;

export const resolveConversationClearGeneration = (
  state: Pick<ChatStore, 'conversationClearGeneration' | 'conversationScopedClearGenerations'>,
  sessionId?: string | null,
  topicId?: string | null,
  threadId?: string | null,
) => {
  if (!sessionId) return state.conversationClearGeneration;

  const topicKey = topicScopedClearKey(sessionId, topicId);
  const laneKey = laneScopedClearKey(sessionId, topicId, threadId);
  const topicScoped = state.conversationScopedClearGenerations[topicKey] ?? 0;
  const laneScoped = state.conversationScopedClearGenerations[laneKey] ?? 0;

  return Math.max(state.conversationClearGeneration, topicScoped, laneScoped);
};

export const bumpTopicScopedClearGeneration = (
  state: Pick<ChatStore, 'conversationClearGeneration' | 'conversationScopedClearGenerations'>,
  sessionId: string,
  topicId?: string | null,
) => {
  const topicKey = topicScopedClearKey(sessionId, topicId);
  let scopedMax = state.conversationScopedClearGenerations[topicKey] ?? 0;

  for (const [key, value] of Object.entries(state.conversationScopedClearGenerations)) {
    if (key === topicKey || key.startsWith(`${topicKey}:`)) {
      scopedMax = Math.max(scopedMax, value);
    }
  }

  const nextScoped = Math.max(state.conversationClearGeneration, scopedMax) + 1;

  return {
    conversationScopedClearGenerations: {
      ...state.conversationScopedClearGenerations,
      [topicKey]: nextScoped,
    },
  };
};

export const bumpLaneScopedClearGeneration = (
  state: Pick<ChatStore, 'conversationClearGeneration' | 'conversationScopedClearGenerations'>,
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
) => {
  const laneKey = laneScopedClearKey(sessionId, topicId, threadId);
  const nextScoped =
    resolveConversationClearGeneration(state, sessionId, topicId, threadId) + 1;

  return {
    conversationScopedClearGenerations: {
      ...state.conversationScopedClearGenerations,
      [laneKey]: nextScoped,
    },
  };
};

/** Topic-wide tombstone (e.g. topic delete). Prefer {@link bumpLaneScopedClearGeneration} for Stop. */
export const bumpScopedConversationClearGeneration = bumpTopicScopedClearGeneration;
