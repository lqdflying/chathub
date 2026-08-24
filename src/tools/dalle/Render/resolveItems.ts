import { UIChatMessage } from '@lobechat/types';

import { parseChatImageToolItems } from '@/helpers/chatImageTaskId';
import { DallEImageItem } from '@/types/tool/dalle';

/**
 * Prefer the live tool-message JSON (and `imageList` from `messages_files`)
 * over the parsed `content` prop. A stale BuiltinType/useParseContent chain
 * can keep Prompt-only tiles after `updateImageItem` already wrote `imageId`.
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
  const linked = message?.imageList;
  return items.map((item, index) => {
    const linkedId =
      item.imageId ||
      (linked && linked.length === items.length ? linked[index]?.id : undefined) ||
      (items.length === 1 ? linked?.[0]?.id : undefined);
    return {
      ...item,
      imageId: linkedId,
      messageId,
    };
  });
};

export const dalleMissingImageKey = (items: Array<{ imageId?: string }>) =>
  items.map((item) => (item.imageId ? '1' : '0')).join('');
