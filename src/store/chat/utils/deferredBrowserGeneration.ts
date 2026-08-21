import type { ChatAIChatState } from '../slices/aiChat/initialState';
import { laneScopedClearKey } from './conversationClearGeneration';
import { messageMapKey } from './messageMapKey';

export const deferredBrowserGenerationLaneKey = (
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
) => laneScopedClearKey(sessionId, topicId, threadId);

export const collectDeferredBrowserGenerationMessageIds = (
  lanes: ChatAIChatState['deferredBrowserGenerationLanes'] | undefined,
): Set<string> => {
  const ids = new Set<string>();
  for (const lane of Object.values(lanes || {})) {
    if (lane.assistantMessageId) ids.add(lane.assistantMessageId);
  }
  return ids;
};

export const deferredBrowserGenerationLaneKeysForTopic = (
  lanes: ChatAIChatState['deferredBrowserGenerationLanes'] | undefined,
  sessionId: string,
  topicId?: string | null,
): string[] => {
  const prefix = `${messageMapKey(sessionId, topicId)}:`;
  return Object.keys(lanes || {}).filter((key) => key.startsWith(prefix));
};

export const findDeferredBrowserGenerationLaneByAssistantId = (
  lanes: ChatAIChatState['deferredBrowserGenerationLanes'] | undefined,
  assistantMessageId: string,
):
  | { key: string; lane: NonNullable<ChatAIChatState['deferredBrowserGenerationLanes']>[string] }
  | undefined => {
  for (const [key, lane] of Object.entries(lanes || {})) {
    if (lane.assistantMessageId === assistantMessageId) return { key, lane };
  }
  return undefined;
};

export const isDeferredLaneProducerAlive = (
  state: Pick<
    ChatAIChatState,
    'chatLoadingIds' | 'messageInToolsCallingIds' | 'toolCallingStreamIds'
  >,
  assistantMessageId: string,
): boolean => {
  const streamFlags = state.toolCallingStreamIds?.[assistantMessageId];
  return (
    state.chatLoadingIds.includes(assistantMessageId) ||
    state.messageInToolsCallingIds.includes(assistantMessageId) ||
    (Array.isArray(streamFlags) && streamFlags.some(Boolean))
  );
};
