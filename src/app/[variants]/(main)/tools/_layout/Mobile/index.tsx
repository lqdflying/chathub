'use client';

import { ActionIcon } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { Drawer } from 'antd';
import { useTheme } from 'antd-style';
import { Menu as MenuIcon } from 'lucide-react';
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Menu from '@/components/Menu';
import MobileContentLayout from '@/components/server/MobileNavLayout';
import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import { LayoutProps } from '../type';
import { useToolsNav } from '../useToolsNav';

const Layout = memo<LayoutProps>(({ children }) => {
  const { t } = useTranslation('tools');
  const theme = useTheme();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const { activeKey, activeTitle, items, navigateToTool } = useToolsNav();

  const navigationLabel = t('navigation');

  return (
    <>
      <MobileContentLayout
        header={
          <ChatHeader
            center={<ChatHeader.Title title={activeTitle} />}
            left={
              <ActionIcon
                aria-controls="mobile-tools-navigation"
                aria-expanded={navigationOpen}
                aria-label={navigationLabel}
                icon={MenuIcon}
                onClick={() => setNavigationOpen(true)}
                size={MOBILE_HEADER_ICON_SIZE}
                title={navigationLabel}
              />
            }
            style={{ borderBlockEnd: `1px solid ${theme.colorBorderSecondary}` }}
          />
        }
        padding={12}
        style={{ background: theme.colorBgContainerSecondary }}
        withNav
      >
        {children}
      </MobileContentLayout>
      <Drawer
        id="mobile-tools-navigation"
        onClose={() => setNavigationOpen(false)}
        open={navigationOpen}
        placement="left"
        styles={{ body: { padding: 12 } }}
        title={t('title')}
        width={'min(320px, 86vw)'}
      >
        <Menu
          compact
          items={items}
          onClick={({ key }) => {
            navigateToTool(key);
            setNavigationOpen(false);
          }}
          selectable
          selectedKeys={[activeKey]}
        />
      </Drawer>
    </>
  );
});

Layout.displayName = 'MobileToolsLayout';

export default Layout;
