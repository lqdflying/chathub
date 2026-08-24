import { UIChatMessage } from '@lobechat/types';

import { parseChatImageToolItems, singletonLinkedChatImageId } from '@/helpers/chatImageTaskId';
import { DallEImageItem } from '@/types/tool/dalle';

/**
 * Prefer the live tool-message JSON over the parsed `content` prop. A stale
 * BuiltinType/useParseContent chain can keep Prompt-only tiles after
 * `updateImageItem` already wrote `imageId`. `imageList` from `messages_files`
 * is an unordered bag — only a one-prompt / one-link message may use it.
 */
export const resolveDalleRenderItems = (
  content: unknown,
  message: Pick<UIChatMessage, 'content' | 'imageList'> | undefined,
  messageId: string,
): Array<DallEImageItem & { messageId: string }> => {
  const raw = message?.content ?? content;
  const parsed = Array.isArray(raw)
    ? (raw as DallEImageItem[])
    : (parseChatImageToolItems(raw) as DallEImageItem[] | undefined);
  const items = parsed ?? [];
  const singletonId = singletonLinkedChatImageId(items.length, message?.imageList);
  return items.map((item) => ({
    ...item,
    imageId: item.imageId || singletonId,
    messageId,
  }));
};

export const dalleMissingImageKey = (items: Array<{ imageId?: string }>) =>
  items.map((item) => (item.imageId ? '1' : '0')).join('');
