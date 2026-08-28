/** Scoped key for in-flight idempotent topic-create identities. */
export const buildPendingTopicClientIdKey = (
  userScope: string,
  containerId: string,
  clearGeneration: number,
): string => `${userScope}:${containerId}:${clearGeneration}`;
