import { ThreadType, type UIChatMessage } from '@lobechat/types';

/**
 * Messages a thread request actually sends.
 * Standalone threads include the source message. Continuation threads include
 * the topic prefix through that source message, then the thread's own rows.
 */
export const filterMessagesForConversationThread = (
  messages: UIChatMessage[],
  thread?: { id: string; sourceMessageId: string; type?: string | null } | null,
) => {
  if (!thread) return messages.filter((message) => !message.threadId);

  const children = messages.filter((message) => message.threadId === thread.id);
  if (thread.type === ThreadType.Standalone || thread.type === 'standalone') {
    return [...messages.filter((message) => message.id === thread.sourceMessageId), ...children];
  }

  const sourceIndex = messages.findIndex((message) => message.id === thread.sourceMessageId);
  const prefix = sourceIndex >= 0 ? messages.slice(0, sourceIndex + 1) : [];
  return [...prefix, ...children];
};

export const selectScopedConversationMessages = ({
  messages,
  thread,
  threadId,
}: {
  messages: UIChatMessage[];
  thread?: { id: string; sourceMessageId?: string; type?: string | null } | null;
  threadId?: string | null;
}): { complete: boolean; messages: UIChatMessage[] } => {
  if (!threadId) {
    return { complete: true, messages: messages.filter((message) => !message.threadId) };
  }

  if (!thread?.sourceMessageId) {
    return {
      complete: false,
      messages: messages.filter((message) => message.threadId === threadId),
    };
  }

  const selected = filterMessagesForConversationThread(messages, {
    id: thread.id || threadId,
    sourceMessageId: thread.sourceMessageId,
    type: thread.type,
  });
  return {
    complete: messages.some((message) => message.id === thread.sourceMessageId),
    messages: selected,
  };
};
