/** Scoped key for in-flight idempotent topic-create identities. */
export const buildPendingTopicClientIdKey = (
  userScope: string,
  containerId: string,
  clearGeneration: number,
): string => `${userScope}:${containerId}:${clearGeneration}`;

export const isPendingUncreatedTopicId = (
  pendingTopicClientIds: Record<string, string>,
  topicId?: string | null,
): topicId is string => !!topicId && Object.values(pendingTopicClientIds).includes(topicId);

export const findPendingTopicClientId = (
  pendingTopicClientIds: Record<string, string>,
  topicId?: string | null,
): string | undefined => (isPendingUncreatedTopicId(pendingTopicClientIds, topicId) ? topicId : undefined);

export const shouldIgnoreEmptyFetchedMessages = (
  state: {
    mainSendMessageOperations: Record<string, { isLoading?: boolean } | undefined>;
    pendingTopicClientIds: Record<string, string>;
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
