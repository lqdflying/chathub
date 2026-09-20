/** Scoped key for in-flight idempotent topic-create identities. */
export const buildPendingTopicClientIdKey = (
  userScope: string,
  containerId: string,
  clearGeneration: number,
): string => `${userScope}:${containerId}:${clearGeneration}`;

export interface PendingTopicClientIntent {
  id: string;
  topicMessageIds: string[];
}

export type PendingTopicClientIds = Record<string, PendingTopicClientIntent>;

export const findPendingTopicClientIntent = (
  pendingTopicClientIds: PendingTopicClientIds,
  topicId?: string | null,
): PendingTopicClientIntent | undefined => {
  if (!topicId) return undefined;
  return Object.values(pendingTopicClientIds).find((intent) => intent.id === topicId);
};

export const isPendingUncreatedTopicId = (
  pendingTopicClientIds: PendingTopicClientIds,
  topicId?: string | null,
): topicId is string => !!findPendingTopicClientIntent(pendingTopicClientIds, topicId);

export const findPendingTopicClientId = (
  pendingTopicClientIds: PendingTopicClientIds,
  topicId?: string | null,
): string | undefined => findPendingTopicClientIntent(pendingTopicClientIds, topicId)?.id;

export const shouldIgnoreEmptyFetchedMessages = (
  state: {
    mainSendMessageOperations: Record<string, { isLoading?: boolean } | undefined>;
    pendingTopicClientIds: PendingTopicClientIds;
    serverGenerationOperations: Record<string, Record<string, unknown>>;
  },
  input: {
    incoming: { id: string }[];
    mapKey: string;
    previous: { id: string }[];
    topicId?: string | null;
  },
): boolean => {
  if (input.incoming.length > 0 || input.previous.length === 0) return false;

  return (
    isPendingUncreatedTopicId(state.pendingTopicClientIds, input.topicId) ||
    Boolean(state.mainSendMessageOperations[input.mapKey]?.isLoading) ||
    input.previous.some((message) => String(message.id).startsWith('tmp_')) ||
    Object.keys(state.serverGenerationOperations[input.mapKey] || {}).length > 0
  );
};
