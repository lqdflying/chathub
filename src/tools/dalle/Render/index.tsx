import { BuiltinRenderProps } from '@lobechat/types';
import { ActionIcon, PreviewGroup } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Download } from 'lucide-react';
import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Flexbox } from 'react-layout-kit';

import { fileService } from '@/services/file';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { useImageStore } from '@/store/image';
import { DallEImageItem } from '@/types/tool/dalle';

import GalleyGrid from './GalleyGrid';
import ImageItem from './Item';
import { dalleMissingImageKey, resolveDalleRenderItems } from './resolveItems';

const DallE = memo<BuiltinRenderProps<DallEImageItem[]>>(({ content, messageId }) => {
  const currentRef = useRef(0);
  const reconcileDallETasks = useChatStore((s) => s.reconcileDallETasks);
  const isImageConfigReady = useImageStore((s) => s.isInit);
  const liveMessage = useChatStore((s) => {
    const message = chatSelectors.getMessageById(messageId)(s);
    if (!message) return undefined;
    return { content: message.content, imageList: message.imageList };
  }, isEqual);

  const items = useMemo(
    () => resolveDalleRenderItems(content, liveMessage, messageId),
    [content, liveMessage, messageId],
  );
  const missingImageKey = dalleMissingImageKey(items);

  // A generation task can outlive the tab that started it (reload/navigation):
  // on mount, adopt finished results / resume pending ones for this message.
  // Also rerun when the owner's image config finishes hydrating — recovery
  // needs a resolved model, and hydration can settle after the bounded wait
  // inside reconcile has already expired. Re-run when tiles become prompt-only
  // again (stale fetch wipe after attach); while a waiter still owns the
  // per-item key this rerun returns without doing anything.
  useEffect(() => {
    reconcileDallETasks(messageId);
  }, [messageId, reconcileDallETasks, isImageConfigReady, missingImageKey]);

  const handleDownload = async () => {
    // 1. Retrieve the blob URL of an image by its imageId
    const id = items[currentRef.current]?.imageId;
    if (!id) return;
    const { url, name } = await fileService.getFile(id);
    // 2. Download the image
    const link = document.createElement('a');
    link.href = url;
    link.download = name; // 设置下载的文件名
    link.click();
  };

  return (
    <Flexbox gap={16}>
      <PreviewGroup
        preview={
          {
            // 切换图片时设置
            onChange: (current: number) => {
              currentRef.current = current;
            },
            // 点击预览显示时设置

            onVisibleChange: (visible: boolean, _prevVisible: boolean, current: number) => {
              currentRef.current = current;
            },
            toolbarAddon: <ActionIcon color={'#fff'} icon={Download} onClick={handleDownload} />,
          } as any
        }
      >
        <GalleyGrid items={items} renderItem={ImageItem} />
      </PreviewGroup>
    </Flexbox>
  );
});

export default DallE;
