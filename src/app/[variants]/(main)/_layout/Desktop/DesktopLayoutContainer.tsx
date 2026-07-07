import { useTheme } from 'antd-style';
import { usePathname } from 'next/navigation';
import { PropsWithChildren, Suspense, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { SHELL_BORDER_RADIUS } from '@/const/layoutTokens';

import SideBar from './SideBar';

const DesktopLayoutContainer = memo<PropsWithChildren>(({ children }) => {
  const theme = useTheme();
  const pathname = usePathname();
  const hideSideBar = pathname.startsWith('/settings');
  return (
    <>
      <Suspense>
        {!hideSideBar && <SideBar />}
      </Suspense>
      <Flexbox
        style={{
          background: theme.colorBgLayout,
          borderInlineStart: hideSideBar ? undefined : `1px solid ${theme.colorBorderSecondary}`,
          borderStartStartRadius: !hideSideBar ? SHELL_BORDER_RADIUS : undefined,
          borderTop: hideSideBar ? undefined : `1px solid ${theme.colorBorderSecondary}`,
          boxShadow: !hideSideBar ? `0 0 0 1px ${theme.colorFillQuaternary}` : undefined,
          overflow: 'hidden',
        }}
        width={'100%'}
      >
        {children}
      </Flexbox>
    </>
  );
});
export default DesktopLayoutContainer;
