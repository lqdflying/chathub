'use client';

import { useTheme } from 'antd-style';
import { PropsWithChildren, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { CHAT_PANEL_GAP, CHAT_PANEL_RADIUS } from '@/const/layoutTokens';

const Workspace = memo<PropsWithChildren>(({ children }) => {
  const theme = useTheme();
  return (
    <Flexbox
      flex={1}
      style={{
        background: `linear-gradient(180deg, ${theme.colorBgLayout} 0%, ${theme.colorBgContainerSecondary} 100%)`,
        overflow: 'hidden',
        padding: CHAT_PANEL_GAP,
        position: 'relative',
      }}
    >
      <Flexbox
        flex={1}
        style={{
          background: theme.colorBgContainer,
          border: `1px solid ${theme.colorBorderSecondary}`,
          borderRadius: CHAT_PANEL_RADIUS,
          boxShadow: `0 1px 0 ${theme.colorFillQuaternary}`,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {children}
      </Flexbox>
    </Flexbox>
  );
});

export default Workspace;
