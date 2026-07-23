'use client';

import { ActionIcon } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { Drawer } from 'antd';
import { useTheme } from 'antd-style';
import { ListTree, SlidersHorizontal } from 'lucide-react';
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import NProgress from '@/components/NProgress';
import MobileContentLayout from '@/components/server/MobileNavLayout';

import { LayoutProps } from '../type';

const HEADER_ACTION_SIZE = { blockSize: 44, size: 22 };

const Layout = memo<LayoutProps>(({ children, menu, topic }) => {
  const { t } = useTranslation(['common', 'image']);
  const theme = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);

  return (
    <>
      <NProgress />
      <MobileContentLayout
        header={
          <ChatHeader
            center={<ChatHeader.Title title={t('tab.aiImage', { ns: 'common' })} />}
            right={
              <>
                <ActionIcon
                  aria-controls="mobile-image-settings"
                  aria-expanded={settingsOpen}
                  aria-label={t('config.header.title', { ns: 'image' })}
                  icon={SlidersHorizontal}
                  onClick={() => setSettingsOpen(true)}
                  size={HEADER_ACTION_SIZE}
                  title={t('config.header.title', { ns: 'image' })}
                  tooltipProps={{ placement: 'bottom' }}
                />
                <ActionIcon
                  aria-controls="mobile-image-topics"
                  aria-expanded={topicsOpen}
                  aria-label={t('topic.title', { ns: 'image' })}
                  icon={ListTree}
                  onClick={() => setTopicsOpen(true)}
                  size={HEADER_ACTION_SIZE}
                  title={t('topic.title', { ns: 'image' })}
                  tooltipProps={{ placement: 'bottom' }}
                />
              </>
            }
            style={{
              borderBlockEnd: `1px solid ${theme.colorBorderSecondary}`,
              width: '100%',
            }}
          />
        }
        style={{
          background: theme.colorBgContainerSecondary,
        }}
        withNav
      >
        <Flexbox
          gap={16}
          minHeight="100%"
          padding={12}
          style={{ margin: '0 auto', maxWidth: 906 }}
          width="100%"
        >
          {children}
        </Flexbox>
      </MobileContentLayout>
      <Drawer
        bodyStyle={{ height: '100%', padding: 0 }}
        height="88dvh"
        id="mobile-image-settings"
        onClose={() => setSettingsOpen(false)}
        open={settingsOpen}
        placement="bottom"
        title={t('config.header.title', { ns: 'image' })}
      >
        {menu}
      </Drawer>
      <Drawer
        bodyStyle={{ height: '100%', padding: 0 }}
        id="mobile-image-topics"
        onClose={() => setTopicsOpen(false)}
        open={topicsOpen}
        placement="right"
        title={t('topic.title', { ns: 'image' })}
        width="min(88vw, 360px)"
      >
        {topic}
      </Drawer>
    </>
  );
});

Layout.displayName = 'MobileImageLayout';

export default Layout;
