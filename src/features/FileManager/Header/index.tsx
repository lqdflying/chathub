'use client';

import { ChatHeader } from '@lobehub/ui/chat';
import React, { memo } from 'react';

import FilesSearchBar from './FilesSearchBar';
import TogglePanelButton from './TogglePanelButton';
import UploadFileButton from './UploadFileButton';

interface HeaderProps {
  knowledgeBaseId?: string;
  knowledgeMode?: boolean;
  mobile?: boolean;
}

const Header = memo<HeaderProps>(({ knowledgeBaseId, knowledgeMode, mobile = false }) => {
  return (
    <ChatHeader
      left={
        mobile ? (
          <FilesSearchBar mobile />
        ) : (
          <>
            <TogglePanelButton />
            <FilesSearchBar />
          </>
        )
      }
      // On mobile the shell owns the upload affordance to avoid mounting a
      // second `DragUpload` (which attaches window-level paste/drop handlers
      // that would double-upload). Only the desktop header renders it here.
      right={
        mobile ? undefined : (
          <UploadFileButton knowledgeBaseId={knowledgeBaseId} knowledgeMode={knowledgeMode} />
        )
      }
      styles={{
        left: { padding: 0 },
      }}
    />
  );
});

export default Header;
