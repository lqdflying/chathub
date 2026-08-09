'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import PanelTitle from '@/components/PanelTitle';
import FilePanel from '@/features/FileSidePanel';

import KnowledgeBaseList from '../../components/KnowledgeBaseList';
import KnowledgeRouteContainer from '../KnowledgeRouteContainer';

/**
 * Knowledge Bases List Page (desktop).
 *
 * On compact screens the mobile Knowledge shell canonicalizes `/knowledge/bases`
 * to `/knowledge` and opens the navigation drawer, so this placeholder only
 * renders for desktop direct links.
 */
const KnowledgeBasesListPage = memo(() => {
  const { t } = useTranslation('file');

  return (
    <KnowledgeRouteContainer>
      <FilePanel>
        <Flexbox gap={16} height={'100%'} paddingInline={8}>
          <PanelTitle title={t('knowledgeBase.title')} />
          <KnowledgeBaseList />
        </Flexbox>
      </FilePanel>
      <Flexbox
        align="center"
        flex={1}
        justify="center"
        style={{ overflow: 'hidden', position: 'relative' }}
      >
        <div>Select a knowledge base to view details</div>
      </Flexbox>
    </KnowledgeRouteContainer>
  );
});

KnowledgeBasesListPage.displayName = 'KnowledgeBasesListPage';

export default KnowledgeBasesListPage;
