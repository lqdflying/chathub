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

/**
 * Assistant ids plus in-flight tool rows whose parent is a deferred assistant.
 * Topic switch must not abort those MCP/plugin controllers.
 */
export const collectDeferredBrowserGenerationProtectedIds = (
  lanes: ChatAIChatState['deferredBrowserGenerationLanes'] | undefined,
  messagesMap?: Record<string, Array<{ id: string; parentId?: string | null }> | undefined>,
): Set<string> => {
  const ids = collectDeferredBrowserGenerationMessageIds(lanes);
  if (ids.size === 0 || !messagesMap) return ids;

  for (const messages of Object.values(messagesMap)) {
    for (const message of messages || []) {
      if (message.parentId && ids.has(message.parentId)) {
        ids.add(message.id);
      }
    }
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

export const hasActiveToolCallingStream = (streamFlags: boolean[] | undefined): boolean =>
  Array.isArray(streamFlags) && streamFlags.some(Boolean);

export const isDeferredLaneProducerAlive = (
  state: Pick<
    ChatAIChatState,
    'chatLoadingIds' | 'messageInToolsCallingIds' | 'toolCallingStreamIds'
  >,
  assistantMessageId: string,
): boolean =>
  state.chatLoadingIds.includes(assistantMessageId) ||
  state.messageInToolsCallingIds.includes(assistantMessageId) ||
  hasActiveToolCallingStream(state.toolCallingStreamIds?.[assistantMessageId]);

export const isDeferredBrowserLaneAssistant = (
  lanes: ChatAIChatState['deferredBrowserGenerationLanes'] | undefined,
  sessionId: string,
  topicId: string | null | undefined,
  threadId: string | null | undefined,
  assistantMessageId: string,
): boolean =>
  lanes?.[deferredBrowserGenerationLaneKey(sessionId, topicId, threadId)]?.assistantMessageId ===
  assistantMessageId;

/**
 * True when the assistant already has tool result rows but no follow-up
 * assistant whose parent is one of those tools. That is the "Tavily returned,
 * model never continued" hang.
 */
export const hasPendingModelContinue = (
  messages: Array<{ id: string; parentId?: string | null; role?: string }>,
  assistantMessageId: string,
): boolean => {
  const toolIds = messages
    .filter((message) => message.role === 'tool' && message.parentId === assistantMessageId)
    .map((message) => message.id);
  if (toolIds.length === 0) return false;

  const toolIdSet = new Set(toolIds);
  return !messages.some(
    (message) =>
      message.role === 'assistant' && Boolean(message.parentId) && toolIdSet.has(message.parentId!),
  );
};
