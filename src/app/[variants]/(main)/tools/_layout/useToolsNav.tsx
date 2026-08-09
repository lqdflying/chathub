'use client';

import { Icon } from '@lobehub/ui';
import { Images, KeyRound, Zap } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { MenuProps } from '@/components/Menu';

const TOOL_NAV_KEYS = ['picbed', 'password', 'apitest'] as const;

export type ToolNavKey = (typeof TOOL_NAV_KEYS)[number];

const isToolNavKey = (routeSegment: string | undefined): routeSegment is ToolNavKey =>
  routeSegment !== undefined && (TOOL_NAV_KEYS as readonly string[]).includes(routeSegment);

export const getActiveToolNavKey = (pathname: string): ToolNavKey => {
  const routeSegment = pathname.split('/').filter(Boolean).at(1);

  return isToolNavKey(routeSegment) ? routeSegment : 'picbed';
};

export const useToolsNav = () => {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation('tools');

  const activeKey = getActiveToolNavKey(pathname);
  const items: MenuProps['items'] = useMemo(
    () => [
      {
        icon: <Icon icon={Images} />,
        key: 'picbed',
        label: t('picbed.title'),
      },
      {
        icon: <Icon icon={KeyRound} />,
        key: 'password',
        label: t('password.title'),
      },
      {
        icon: <Icon icon={Zap} />,
        key: 'apitest',
        label: t('apitest.title'),
      },
    ],
    [t],
  );
  const activeTitle = t(`${activeKey}.title`);
  const navigateToTool = useCallback(
    (toolNavKey: string) => {
      if (!isToolNavKey(toolNavKey)) return;

      router.push(`/tools/${toolNavKey}`);
    },
    [router],
  );

  return {
    activeKey,
    activeTitle,
    items,
    navigateToTool,
  };
};
