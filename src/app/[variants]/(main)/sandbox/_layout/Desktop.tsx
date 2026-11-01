'use client';

import { useTheme } from 'antd-style';
import { memo } from 'react';
import { Center, Flexbox } from 'react-layout-kit';

import { LayoutProps } from './type';

const Layout = memo<LayoutProps>(({ children }) => {
  const theme = useTheme();

  return (
    <Center
      flex={1}
      height={'100%'}
      style={{
        background: theme.colorBgContainerSecondary,
        minWidth: 0,
        overflowX: 'hidden',
        overflowY: 'auto',
        position: 'relative',
      }}
      width={'100%'}
    >
      <Flexbox
        gap={16}
        height={'100%'}
        padding={24}
        style={{ maxWidth: 860, minWidth: 0 }}
        width={'100%'}
      >
        {children}
      </Flexbox>
    </Center>
  );
});

Layout.displayName = 'DesktopSandboxHubLayout';

export default Layout;
