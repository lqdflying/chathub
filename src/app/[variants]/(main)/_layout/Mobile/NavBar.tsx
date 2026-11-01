'use client';

import { Icon } from '@lobehub/ui';
import { TabBar, type TabBarProps } from '@lobehub/ui/mobile';
import { Drawer } from 'antd';
import { createStyles } from 'antd-style';
import {
  Boxes,
  Ellipsis,
  FolderClosed,
  Image as ImageIcon,
  Images,
  MessageSquare,
  Search,
  User,
  Wrench,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { rgba } from 'polished';
import React, { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Menu, { type MenuProps } from '@/components/Menu';
import { MOBILE_TABBAR_HEIGHT, MOBILE_TABBAR_SAFE_HEIGHT } from '@/const/layoutTokens';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { SidebarTabKey } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const useStyles = createStyles(({ css, prefixCls, token }) => ({
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
  moreMenu: css`
    .${prefixCls}-menu-item {
      min-height: 48px;
    }
  `,
}));

const NavBar = memo(() => {
  const { t } = useTranslation('common');
  const { styles } = useStyles();
  const routeActiveKey = useActiveTabKey();
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  const { enableKnowledgeBase, showAiImage } = useServerConfigStore(featureFlagsSelectors);
  const enabledSandbox = useServerConfigStore((s) => !!s.serverConfig.enabledSandbox);
  const activeKey =
    pathname === '/knowledge' ||
    pathname.startsWith('/knowledge/') ||
    pathname === '/tools' ||
    pathname.startsWith('/tools/') ||
    pathname === '/sandbox' ||
    pathname.startsWith('/sandbox/') ||
    pathname === '/search' ||
    pathname.startsWith('/search/')
      ? SidebarTabKey.More
      : routeActiveKey;
  const moreSelectedKey =
    pathname === '/knowledge' || pathname.startsWith('/knowledge/')
      ? 'knowledge'
      : pathname === '/tools' || pathname.startsWith('/tools/')
        ? 'tools'
        : pathname === '/sandbox' || pathname.startsWith('/sandbox/')
          ? 'sandbox'
          : pathname === '/search' || pathname.startsWith('/search/')
            ? 'search'
            : undefined;
  const moreItems = useMemo(
    () =>
      [
        {
          icon: <Icon icon={Search} />,
          key: 'search',
          label: t('tab.search'),
        },
        enableKnowledgeBase && {
          icon: <Icon icon={FolderClosed} />,
          key: 'knowledge',
          label: t('tab.knowledgeBase'),
        },
        {
          icon: <Icon icon={Wrench} />,
          key: 'tools',
          label: t('tab.tools'),
        },
        enabledSandbox && {
          icon: <Icon icon={Boxes} />,
          key: 'sandbox',
          label: t('tab.sandbox'),
        },
      ].filter(Boolean) as MenuProps['items'],
    [enableKnowledgeBase, enabledSandbox, t],
  );

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
        {
          icon: (active: boolean) => (
            <Icon className={active ? styles.active : undefined} icon={Ellipsis} />
          ),
          key: SidebarTabKey.More,
          onClick: () => {
            setMoreOpen(true);
          },
          title: t('tab.more'),
        },
      ].filter(Boolean) as TabBarProps['items'],
    [router, showAiImage, styles.active, t],
  );

  return (
    <>
      <TabBar
        activeKey={activeKey}
        className={styles.container}
        height={MOBILE_TABBAR_HEIGHT}
        items={items}
      />
      <Drawer
        height={'auto'}
        id="mobile-more-navigation"
        onClose={() => setMoreOpen(false)}
        open={moreOpen}
        placement="bottom"
        styles={{
          body: {
            paddingBlock: 8,
            paddingBlockEnd: 'calc(8px + env(safe-area-inset-bottom, 0px))',
            paddingInline: 12,
          },
        }}
        title={t('tab.more')}
      >
        <Menu
          className={styles.moreMenu}
          items={moreItems}
          onClick={({ key }) => {
            setMoreOpen(false);
            const routes: Record<string, string> = {
              knowledge: '/knowledge',
              sandbox: '/sandbox',
              search: '/search',
              tools: '/tools',
            };
            router.push(routes[String(key)] ?? '/tools');
          }}
          selectable
          selectedKeys={moreSelectedKey ? [moreSelectedKey] : []}
        />
      </Drawer>
    </>
  );
});

NavBar.displayName = 'NavBar';

export default NavBar;
