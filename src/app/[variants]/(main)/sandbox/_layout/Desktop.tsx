'use client';

import { memo } from 'react';

import SettingContainer from '@/features/Setting/SettingContainer';

import { LayoutProps } from './type';

/** The same frame as the Settings and Profile pages. */
const Layout = memo<LayoutProps>(({ children }) => (
  <SettingContainer flex={1} style={{ paddingBlock: 24, paddingInline: 32 }}>
    {children}
  </SettingContainer>
));

Layout.displayName = 'DesktopSandboxHubLayout';

export default Layout;
