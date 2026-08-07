import { Drawer } from 'antd';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { fileManagerSelectors, useFileStore } from '@/store/file';

import Content from './Content';

// The drawer shows only the converted/chunked content — what the LLM actually
// sees. The original-document preview pane (FileViewer) is intentionally
// removed: Office-type previews delegate to Microsoft Office Online, which
// must fetch the file URL publicly and fails on a private host.
const ChunkDrawer = memo(() => {
  const [fileId, open, closeChunkDrawer] = useFileStore((s) => [
    s.chunkDetailId,
    !!s.chunkDetailId,
    s.closeChunkDrawer,
  ]);
  const file = useFileStore(fileManagerSelectors.getFileById(fileId));

  return (
    <Drawer
      onClose={() => {
        closeChunkDrawer();
      }}
      open={open}
      styles={{
        body: { padding: 0 },
      }}
      title={file?.name}
      width={'60%'}
    >
      <Flexbox height={'100%'} style={{ overflow: 'hidden' }}>
        <Content />
      </Flexbox>
    </Drawer>
  );
});

export default ChunkDrawer;
