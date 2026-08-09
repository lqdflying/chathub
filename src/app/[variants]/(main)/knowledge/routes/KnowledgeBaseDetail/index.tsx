'use client';

import React, { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import FileManager from '@/features/FileManager';
import FilePanel from '@/features/FileSidePanel';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/knowledgeBase';

import { useKnowledgeBaseItem } from '../../hooks/useKnowledgeItem';
import FileModalQueryRoute from '../../shared/FileModalQueryRoute';
import KnowledgeRouteContainer from '../KnowledgeRouteContainer';
import Menu from './menu/Menu';

interface KnowledgeBaseDetailPageProps {
  /** Knowledge base id, parsed from the Next App Router pathname. */
  id: string;
  /** When true, render the compact mobile workspace (no desktop side panel). */
  mobile?: boolean;
}

/**
 * Knowledge Base Detail Page
 * Shows the file list for a specific knowledge base.
 * Supports ?file=[fileId] query param for file preview modal.
 */
const KnowledgeBaseDetailPage = memo<KnowledgeBaseDetailPageProps>(({ id, mobile = false }) => {
  useKnowledgeBaseItem(id);
  const name = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseNameById(id));

  if (!id) {
    return <div>Knowledge base ID is required</div>;
  }

  if (mobile) {
    return (
      <>
        <FileManager knowledgeBaseId={id} knowledgeMode mobile title={name} />
        <FileModalQueryRoute />
      </>
    );
  }

  return (
    <KnowledgeRouteContainer>
      <FilePanel>
        <Menu id={id} />
      </FilePanel>
      <Flexbox flex={1} style={{ overflow: 'hidden', position: 'relative' }}>
        <FileManager knowledgeBaseId={id} knowledgeMode title={name} />
      </Flexbox>
      <FileModalQueryRoute />
    </KnowledgeRouteContainer>
  );
});

KnowledgeBaseDetailPage.displayName = 'KnowledgeBaseDetailPage';

export default KnowledgeBaseDetailPage;
