const MESSAGE_MAP_KEY_VERSION = 1;

export interface MessageMapContext {
  sessionId: string;
  topicId: string | null;
}

type SerializedMessageMapContext = [
  version: typeof MESSAGE_MAP_KEY_VERSION,
  sessionId: string,
  topicId: string | null,
];

export const messageMapKey = (sessionId: string, topicId?: string | null): string =>
  JSON.stringify([
    MESSAGE_MAP_KEY_VERSION,
    sessionId,
    topicId ?? null,
  ] satisfies SerializedMessageMapContext);

export const parseMessageMapKey = (mapKey: string): MessageMapContext | undefined => {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(mapKey);
  } catch {
    return;
  }

  if (!Array.isArray(parsedValue) || parsedValue.length !== 3) return;

  const [version, sessionId, topicId] = parsedValue as unknown[];
  if (version !== MESSAGE_MAP_KEY_VERSION || typeof sessionId !== 'string') return;
  if (topicId !== null && typeof topicId !== 'string') return;

  return {
    sessionId,
    topicId,
  };
};
