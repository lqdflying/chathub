import { BuiltinRenderProps } from '@lobechat/types';
import { ActionIcon, PreviewGroup } from '@lobehub/ui';
import { Download } from 'lucide-react';
import React, { memo, useEffect, useRef } from 'react';
import { Flexbox } from 'react-layout-kit';

import { fileService } from '@/services/file';
import { useChatStore } from '@/store/chat';
import { DallEImageItem } from '@/types/tool/dalle';

import GalleyGrid from './GalleyGrid';
import ImageItem from './Item';

const DallE = memo<BuiltinRenderProps<DallEImageItem[]>>(({ content, messageId }) => {
  const currentRef = useRef(0);
  const reconcileDallETasks = useChatStore((s) => s.reconcileDallETasks);

  // A generation task can outlive the tab that started it (reload/navigation):
  // on mount, adopt finished results / resume pending ones for this message.
  useEffect(() => {
    reconcileDallETasks(messageId);
  }, [messageId, reconcileDallETasks]);

  // While the tool call is still streaming/being transformed, `content` can be
  // the raw arguments object (or undefined) rather than the item array — a
  // bare .map would throw at render and take down the whole chat page.
  const items = Array.isArray(content) ? content : [];

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
        <GalleyGrid items={items.map((c) => ({ ...c, messageId }))} renderItem={ImageItem} />
      </PreviewGroup>
    </Flexbox>
  );
});

export default DallE;
