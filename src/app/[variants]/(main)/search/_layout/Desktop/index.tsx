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
      height={'100%'}
      style={{ background: theme.colorBgContainerSecondary, minWidth: 0, overflow: 'auto' }}
      width={'100%'}
    >
      <Flexbox gap={16} padding={24} style={{ marginInline: 'auto', maxWidth: 880 }} width={'100%'}>
        {children}
      </Flexbox>
    </Flexbox>
  );
});

Layout.displayName = 'DesktopSearchLayout';

export default Layout;
