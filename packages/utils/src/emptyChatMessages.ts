export interface EmptyChatMessageCandidate {
  [key: string]: unknown;
  content?: unknown;
  function_call?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
  reasoning_details?: unknown;
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
 * Provider adapters translate semantic fields before the request is sent:
 * MiniMax serializes `reasoning` into `reasoning_details`, the OpenAI
 * converter forwards legacy `function_call`, and DeepSeek/Moonshot carry
 * `reasoning_content`. A message holding any of these is never "empty",
 * even when its `content` is blank.
 */
const hasSemanticFields = (message: EmptyChatMessageCandidate): boolean => {
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
  if (message.function_call !== undefined && message.function_call !== null) return true;
  for (const key of ['reasoning', 'reasoning_content', 'reasoning_details'] as const) {
    const value = message[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      if (value.trim().length > 0) return true;
    } else if (Array.isArray(value)) {
      if (value.length > 0) return true;
    } else if (typeof value === 'object') {
      const content = (value as Record<string, unknown>).content;
      if (typeof content !== 'string' || content.trim().length > 0) return true;
    } else {
      return true;
    }
  }
  return false;
};

/**
 * Drops chat messages that serialize to fully-empty content.
 *
 * Strict providers reject the whole request when any message carries no
 * content (Moonshot: 400 "content must not be empty"; OpenAI and others
 * behave the same). A message is dropped only when its role is
 * user/assistant/system, it carries no semantic fields (`tool_calls`,
 * `function_call`, `reasoning*`), and its content is empty — `tool`
 * messages are always kept so tool_call/tool_result pairing survives.
 *
 * Must run only after provider normalization (`handlePayload`), because
 * adapters translate semantic fields into their outbound schema first.
 */
export const dropFullyEmptyMessages = <Message extends EmptyChatMessageCandidate>(
  messages: readonly Message[],
): Message[] =>
  messages.filter((message) => {
    if (!DROPPABLE_EMPTY_ROLES.has(message.role ?? '')) return true;
    if (hasSemanticFields(message)) return true;
    return hasMessageContent(message.content);
  });
