'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { useTheme } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MobileContentLayout from '@/components/server/MobileNavLayout';

import { LayoutProps } from '../type';

const Layout = memo<LayoutProps>(({ children }) => {
  const { t } = useTranslation('artifacts');
  const theme = useTheme();

  return (
    <MobileContentLayout
      header={
        <ChatHeader
          center={<ChatHeader.Title title={t('title')} />}
          style={{ borderBlockEnd: `1px solid ${theme.colorBorderSecondary}` }}
        />
      }
      padding={12}
      style={{ background: theme.colorBgContainerSecondary }}
      withNav
    >
      {children}
    </MobileContentLayout>
  );
});

Layout.displayName = 'MobileArtifactsLayout';

export default Layout;
