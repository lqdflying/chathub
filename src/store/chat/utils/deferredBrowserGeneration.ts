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
