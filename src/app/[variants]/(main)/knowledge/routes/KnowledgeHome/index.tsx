'use client';

import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import NProgress from '@/components/NProgress';
import PanelTitle from '@/components/PanelTitle';
import FileManager from '@/features/FileManager';
import FilePanel from '@/features/FileSidePanel';
import { FilesTabs } from '@/types/files';

import { useFileCategory } from '../../hooks/useFileCategory';
import FileModalQueryRoute from '../../shared/FileModalQueryRoute';
import Container from './layout/Container';
import RegisterHotkeys from './layout/RegisterHotkeys';
import FileMenu from './menu/FileMenu';
import KnowledgeBase from './menu/KnowledgeBase';

const MenuContent = memo(() => {
  const { t } = useTranslation('file');

  return (
    <Flexbox gap={16} height={'100%'}>
      <Flexbox paddingInline={8}>
        <PanelTitle desc={t('desc')} title={t('title')} />
        <FileMenu />
      </Flexbox>
      <KnowledgeBase />
    </Flexbox>
  );
});

MenuContent.displayName = 'MenuContent';

// Desktop workspace: file manager filtered by the active category.
const FilesListPage = memo(() => {
  const { t } = useTranslation('file');
  const [category] = useFileCategory();

  return <FileManager category={category} knowledgeMode title={t(`tab.${category}`)} />;
});

FilesListPage.displayName = 'FilesListPage';

// Desktop layout: side panel (categories + knowledge bases) + workspace.
const DesktopLayout = memo(() => {
  return (
    <>
      <NProgress />
      <Flexbox
        height={'100%'}
        horizontal
        style={{ maxWidth: '100%', overflow: 'hidden', position: 'relative' }}
        width={'100%'}
      >
        <FilePanel>
          <MenuContent />
        </FilePanel>
        <Container>
          <FilesListPage />
        </Container>
      </Flexbox>
      <RegisterHotkeys />
      <FileModalQueryRoute />
    </>
  );
});

DesktopLayout.displayName = 'DesktopLayout';

interface KnowledgeHomePageProps {
  /** When true, render the compact mobile workspace (shell provides header + drawer). */
  mobile?: boolean;
}

// Mobile workspace: the shell already renders the header, drawer, and banner;
// the home route only contributes the filtered file manager.
const MobileLayout = memo(() => {
  const { t } = useTranslation('file');
  const [category] = useFileCategory();

  return (
    <>
      <FileManager
        category={category}
        knowledgeMode
        mobile
        title={t(`tab.${category as FilesTabs}`)}
      />
      <FileModalQueryRoute />
    </>
  );
});

MobileLayout.displayName = 'MobileLayout';

// Main Knowledge Home Page
const KnowledgeHomePage = memo<KnowledgeHomePageProps>(({ mobile = false }) => {
  return mobile ? <MobileLayout /> : <DesktopLayout />;
});

KnowledgeHomePage.displayName = 'KnowledgeHomePage';

export default KnowledgeHomePage;
