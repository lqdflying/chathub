export interface ToolCallSequenceItem {
  [key: string]: unknown;
  id?: string;
}

export interface ToolCallSequenceMessage {
  [key: string]: unknown;
  content?: unknown;
  id?: string;
  parentId?: string;
  role?: string;
  tool_call_id?: string;
  tool_calls?: ToolCallSequenceItem[];
}

interface IndexedToolMessage<Message extends ToolCallSequenceMessage> {
  message: Message;
}

type ToolMessageQueue<Message extends ToolCallSequenceMessage> = Array<IndexedToolMessage<Message>>;

const appendToQueue = <Message extends ToolCallSequenceMessage>(
  queues: Map<string, ToolMessageQueue<Message>>,
  toolCallId: string,
  indexedMessage: IndexedToolMessage<Message>,
): void => {
  const queue = queues.get(toolCallId);
  if (queue) {
    queue.push(indexedMessage);
    return;
  }

  queues.set(toolCallId, [indexedMessage]);
};

const hasAssistantContent = (content: unknown): boolean => {
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) return content.length > 0;
  return !!content;
};

/**
 * Repairs OpenAI Chat Completions tool-call history.
 *
 * Tool-call IDs are scoped to one assistant response and may recur in later
 * rounds. Persisted `parentId` ownership takes precedence; messages without a
 * parent use occurrence-ordered per-ID queues for imported or legacy history.
 */
export const repairOpenAIChatToolMessageSequence = <Message extends ToolCallSequenceMessage>(
  messages: readonly Message[],
): Message[] => {
  const parentQueues = new Map<string, Map<string, ToolMessageQueue<Message>>>();
  const legacyQueues = new Map<string, ToolMessageQueue<Message>>();
  const indexedMessageIds = new Set<string>();
  const indexedMessageObjects = new WeakSet<object>();

  for (const message of messages) {
    if (message.role !== 'tool' || typeof message.tool_call_id !== 'string') continue;

    if (typeof message.id === 'string') {
      if (indexedMessageIds.has(message.id)) continue;
      indexedMessageIds.add(message.id);
    } else if (typeof message === 'object' && message !== null) {
      if (indexedMessageObjects.has(message)) continue;
      indexedMessageObjects.add(message);
    }

    const indexedMessage = { message };
    if (typeof message.parentId !== 'string' || message.parentId.length === 0) {
      appendToQueue(legacyQueues, message.tool_call_id, indexedMessage);
      continue;
    }

    let toolCallQueues = parentQueues.get(message.parentId);
    if (!toolCallQueues) {
      toolCallQueues = new Map<string, ToolMessageQueue<Message>>();
      parentQueues.set(message.parentId, toolCallQueues);
    }
    appendToQueue(toolCallQueues, message.tool_call_id, indexedMessage);
  }

  const repairedMessages: Message[] = [];

  for (const message of messages) {
    if (message.role === 'tool') continue;

    if (
      message.role !== 'assistant' ||
      !Array.isArray(message.tool_calls) ||
      message.tool_calls.length === 0
    ) {
      repairedMessages.push(message);
      continue;
    }

    const matchedToolCalls: ToolCallSequenceItem[] = [];
    const matchedToolMessages: Message[] = [];
    const assistantQueues =
      typeof message.id === 'string' ? parentQueues.get(message.id) : undefined;

    for (const toolCall of message.tool_calls) {
      if (typeof toolCall.id !== 'string') continue;

      const parentQueue = assistantQueues?.get(toolCall.id);
      const indexedToolMessage = parentQueue?.shift() ?? legacyQueues.get(toolCall.id)?.shift();
      if (!indexedToolMessage) continue;

      matchedToolCalls.push(toolCall);
      matchedToolMessages.push(indexedToolMessage.message);
    }

    if (matchedToolCalls.length === 0) {
      if (!hasAssistantContent(message.content)) continue;

      const assistantWithoutToolCalls = { ...message };
      delete assistantWithoutToolCalls.tool_calls;
      repairedMessages.push(assistantWithoutToolCalls as Message);
      continue;
    }

    repairedMessages.push(
      {
        ...message,
        tool_calls: matchedToolCalls,
      } as Message,
      ...matchedToolMessages,
    );
  }

  return repairedMessages;
};
