'use client';

import { useTheme } from 'antd-style';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import FileBasicInfo from '@/features/FileManager/ChunkDrawer/FileBasicInfo';
import { FileListItem } from '@/types/files';

export const DETAIL_PANEL_WIDTH = 300;

const FileDetail = memo<FileListItem>((props) => {
  const theme = useTheme();

  if (!props) return null;

  return (
    <Flexbox
      padding={16}
      style={{ borderInlineStart: `1px solid ${theme.colorSplit}` }}
      width={DETAIL_PANEL_WIDTH}
    >
      <FileBasicInfo file={props} />
    </Flexbox>
  );
});

export default FileDetail;
