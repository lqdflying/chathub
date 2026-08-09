'use client';

import { ActionIcon } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { Drawer } from 'antd';
import { useTheme } from 'antd-style';
import { Menu as MenuIcon } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import React, { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import MobileContentLayout from '@/components/server/MobileNavLayout';
import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import UploadFileButton from '@/features/FileManager/Header/UploadFileButton';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/knowledgeBase';

import RagProviderBanner from '../../components/RagProviderBanner';
import { useFileCategory } from '../../hooks/useFileCategory';
import FileMenu from '../../routes/KnowledgeHome/menu/FileMenu';
import KnowledgeBase from '../../routes/KnowledgeHome/menu/KnowledgeBase';

interface KnowledgeMobileShellProps {
  children: React.ReactNode;
}

/**
 * Mobile Knowledge shell.
 *
 * - Owns the safe header (title + navigation + upload) so route content never
 *   has to render its own mobile header.
 * - Hosts the left navigation drawer with file categories and named knowledge
 *   bases; selections close the drawer and push a new history entry.
 * - Reserves the bottom tab-bar safe area exactly once via `MobileContentLayout`
 *   `withNav`, so individual routes must not add `MOBILE_TABBAR_SAFE_HEIGHT`.
 * - Canonicalizes `/knowledge/bases` to `/knowledge` (desktop placeholder is
 *   unreachable on mobile) and opens the drawer so the user can pick a base.
 */
const KnowledgeMobileShell = memo<KnowledgeMobileShellProps>(({ children }) => {
  const { t } = useTranslation('file');
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  const [navigationOpen, setNavigationOpen] = useState(false);

  const detailMatch = useMemo(() => pathname?.match(/^\/knowledge\/bases\/([^/]+)$/), [pathname]);
  const knowledgeBaseId = detailMatch?.[1];

  const [category] = useFileCategory();
  const baseName = useKnowledgeBaseStore(
    knowledgeBaseSelectors.getKnowledgeBaseNameById(knowledgeBaseId ?? ''),
  );

  // Canonicalize the desktop-only `/knowledge/bases` placeholder on mobile and
  // surface the drawer so the user can choose a knowledge base.
  useEffect(() => {
    if (pathname === '/knowledge/bases') {
      setNavigationOpen(true);
      router.replace('/knowledge');
    }
  }, [pathname, router]);

  const title = knowledgeBaseId ? baseName ?? '' : t(`tab.${category}`);
  const navigationLabel = t('mobile.navigation');

  const closeDrawer = () => setNavigationOpen(false);

  return (
    <>
      <MobileContentLayout
        header={
          <ChatHeader
            center={<ChatHeader.Title title={title} />}
            left={
              <ActionIcon
                aria-controls="mobile-knowledge-navigation"
                aria-expanded={navigationOpen}
                aria-label={navigationLabel}
                icon={MenuIcon}
                onClick={() => setNavigationOpen(true)}
                size={MOBILE_HEADER_ICON_SIZE}
                title={navigationLabel}
              />
            }
            right={
              <UploadFileButton
                knowledgeBaseId={knowledgeBaseId}
                knowledgeMode
                mobile
              />
            }
            style={{ borderBlockEnd: `1px solid ${theme.colorBorderSecondary}` }}
          />
        }
        style={{ background: theme.colorBgContainerSecondary }}
        withNav
      >
        <Flexbox style={{ paddingBlock: 8 }}>
          <RagProviderBanner />
        </Flexbox>
        {children}
      </MobileContentLayout>
      <Drawer
        id="mobile-knowledge-navigation"
        onClose={closeDrawer}
        open={navigationOpen}
        placement="left"
        styles={{ body: { padding: 12 } }}
        title={t('title')}
        width={'min(320px, 86vw)'}
      >
        <Flexbox gap={16} height={'100%'}>
          <FileMenu onSelect={closeDrawer} />
          <KnowledgeBase onNavigate={closeDrawer} />
        </Flexbox>
      </Drawer>
    </>
  );
});

KnowledgeMobileShell.displayName = 'KnowledgeMobileShell';

export default KnowledgeMobileShell;