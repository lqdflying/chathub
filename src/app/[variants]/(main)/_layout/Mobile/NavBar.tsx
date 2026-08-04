'use client';

import { Icon } from '@lobehub/ui';
import { TabBar, type TabBarProps } from '@lobehub/ui/mobile';
import { createStyles } from 'antd-style';
import { Image as ImageIcon, Images, MessageSquare, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { rgba } from 'polished';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_TABBAR_HEIGHT, MOBILE_TABBAR_SAFE_HEIGHT } from '@/const/layoutTokens';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { SidebarTabKey } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const useStyles = createStyles(({ css, token }) => ({
  active: css`
    svg {
      fill: ${rgba(token.colorPrimary, 0.33)};
    }
  `,
  container: css`
    position: fixed;
    z-index: 100;
    inset-block-end: 0;
    inset-inline: 0 0;

    display: flex;
    align-items: center;

    height: ${MOBILE_TABBAR_SAFE_HEIGHT};
    padding-block-end: env(safe-area-inset-bottom, 0);
    border-block-start: 1px solid ${token.colorBorderSecondary};

    background: ${token.colorBgContainer};
    box-shadow: 0 -1px 0 ${token.colorFillQuaternary};
  `,
}));

const NavBar = memo(() => {
  const { t } = useTranslation('common');
  const { styles } = useStyles();
  const activeKey = useActiveTabKey();
  const router = useRouter();

  const { showAiImage } = useServerConfigStore(featureFlagsSelectors);

  const items: TabBarProps['items'] = useMemo(
    () =>
      [
        {
          icon: (active: boolean) => (
            <Icon className={active ? styles.active : undefined} icon={MessageSquare} />
          ),
          key: SidebarTabKey.Chat,
          onClick: () => {
            router.push('/chat');
          },
          title: t('tab.chat'),
        },
        showAiImage && {
          icon: (active: boolean) => (
            <Icon className={active ? styles.active : undefined} icon={ImageIcon} />
          ),
          key: SidebarTabKey.Image,
          onClick: () => {
            router.push('/image');
          },
          title: t('tab.aiImage'),
        },
        {
          icon: (active: boolean) => (
            <Icon className={active ? styles.active : undefined} icon={Images} />
          ),
          key: SidebarTabKey.Artifacts,
          onClick: () => {
            router.push('/artifacts');
          },
          title: t('tab.artifacts'),
        },
        {
          icon: (active: boolean) => (
            <Icon className={active ? styles.active : undefined} icon={User} />
          ),
          key: SidebarTabKey.Me,
          onClick: () => {
            router.push('/me');
          },
          title: t('tab.me'),
        },
      ].filter(Boolean) as TabBarProps['items'],
    [router, showAiImage, styles.active, t],
  );

  return (
    <TabBar
      activeKey={activeKey}
      className={styles.container}
      height={MOBILE_TABBAR_HEIGHT}
      items={items}
    />
  );
});

NavBar.displayName = 'NavBar';

export default NavBar;
