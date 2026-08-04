'use client';

import { useTheme } from 'antd-style';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { LayoutProps } from '../type';

const Layout = memo<LayoutProps>(({ children }) => {
  const theme = useTheme();

  return (
    <Flexbox
      flex={1}
      style={{
        background: theme.colorBgContainerSecondary,
        minWidth: 0,
        overflowX: 'hidden',
        overflowY: 'auto',
      }}
      width={'100%'}
    >
      <Flexbox gap={24} margin={'0 auto'} maxWidth={1440} padding={24} width={'100%'}>
        {children}
      </Flexbox>
    </Flexbox>
  );
});

Layout.displayName = 'DesktopArtifactsLayout';

export default Layout;
