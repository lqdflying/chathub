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
      right={
        <UploadFileButton
          knowledgeBaseId={knowledgeBaseId}
          knowledgeMode={knowledgeMode}
          mobile={mobile}
        />
      }
      styles={{
        left: { padding: 0 },
      }}
    />
  );
});

export default Header;
