import type { UIChatMessage } from '@lobechat/types';

type RevisionMessage = Pick<UIChatMessage, 'content' | 'id' | 'tools' | 'updatedAt'>;

/**
 * Cheap conversation fingerprint for live UI work.
 * Joining full `content` / tool JSON on every Zustand update copies hundreds of
 * KB on large topics and stalls typing / scroll. Length + `updatedAt` is enough
 * to know the estimate / compaction watchers must rerun.
 */
export const createConversationMessageRevision = (
  messages: Array<RevisionMessage> | undefined,
): string => {
  if (!messages?.length) return '0';

  let revision = String(messages.length);
  for (const message of messages) {
    const contentLength = typeof message.content === 'string' ? message.content.length : 0;
    revision += `|${message.id}:${message.updatedAt ?? ''}:${contentLength}:${message.tools?.length ?? 0}`;
  }
  return revision;
};
