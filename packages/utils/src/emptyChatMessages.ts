export interface EmptyChatMessageCandidate {
  [key: string]: unknown;
  content?: unknown;
  role?: string;
  tool_calls?: unknown[];
}

const DROPPABLE_EMPTY_ROLES = new Set(['assistant', 'system', 'user']);

const hasMessageContent = (content: unknown): boolean => {
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) {
    return content.some((part) => {
      if (!part || typeof part !== 'object') return false;
      const record = part as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text.trim().length > 0;
      // non-text parts (image_url, input_audio, ...) still count as content
      return typeof record.type === 'string' && record.type !== 'text';
    });
  }
  return content !== null && content !== undefined;
};

/**
 * Drops chat messages that serialize to fully-empty content.
 *
 * Strict providers reject the whole request when any message carries no
 * content (Moonshot: 400 "content must not be empty"; OpenAI and others
 * behave the same). A message is dropped only when its role is
 * user/assistant/system, it has no `tool_calls`, and its content is empty —
 * `tool` messages are always kept so tool_call/tool_result pairing survives.
 */
export const dropFullyEmptyMessages = <Message extends EmptyChatMessageCandidate>(
  messages: readonly Message[],
): Message[] =>
  messages.filter((message) => {
    if (!DROPPABLE_EMPTY_ROLES.has(message.role ?? '')) return true;
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
    return hasMessageContent(message.content);
  });
