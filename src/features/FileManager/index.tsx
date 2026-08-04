'use client';

import { Text } from '@lobehub/ui';
import dynamic from 'next/dynamic';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import FileList from './FileList';
import Header from './Header';
import UploadDock from './UploadDock';

const ChunkDrawer = dynamic(() => import('./ChunkDrawer'), { ssr: false });

interface FileManagerProps {
  category?: string;
  knowledgeBaseId?: string;
  knowledgeMode?: boolean;
  onOpenFile: (id: string) => void;
  title: string;
}
const FileManager = memo<FileManagerProps>(
  ({ title, knowledgeBaseId, knowledgeMode = false, category, onOpenFile }) => {
  return (
    <>
      <Header knowledgeBaseId={knowledgeBaseId} knowledgeMode={knowledgeMode} />
      <Flexbox gap={12} height={'100%'}>
        <Text strong style={{ fontSize: 16, marginBlock: 16, marginInline: 24 }}>
          {title}
        </Text>
        <FileList
          category={category}
          knowledgeBaseId={knowledgeBaseId}
          knowledgeMode={knowledgeMode}
          onOpenFile={onOpenFile}
        />
      </Flexbox>
      <UploadDock />
      <ChunkDrawer />
    </>
  );
  },
);

export default FileManager;
