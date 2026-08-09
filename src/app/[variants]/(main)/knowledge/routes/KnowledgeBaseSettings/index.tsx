'use client';

import React, { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import FilePanel from '@/features/FileSidePanel';

import Menu from '../KnowledgeBaseDetail/menu/Menu';

interface KnowledgeBaseSettingsPageProps {
  /** Knowledge base id, parsed from the Next App Router pathname. */
  id: string;
}

/**
 * Knowledge Base Settings Page
 * Configuration page for a specific knowledge base.
 */
const KnowledgeBaseSettingsPage = memo<KnowledgeBaseSettingsPageProps>(({ id }) => {
  if (!id) {
    return <div>Knowledge base ID is required</div>;
  }

  return (
    <>
      <FilePanel>
        <Menu id={id} />
      </FilePanel>
      <Flexbox align="center" flex={1} justify="center" style={{ overflow: 'hidden' }}>
        {/* TODO: Add settings form components here */}
        <div>Settings page for knowledge base: {id}</div>
      </Flexbox>
    </>
  );
});

KnowledgeBaseSettingsPage.displayName = 'KnowledgeBaseSettingsPage';

export default KnowledgeBaseSettingsPage;
