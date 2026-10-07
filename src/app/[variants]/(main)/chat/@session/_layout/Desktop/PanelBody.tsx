'use client';

import { ScrollShadow } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { PropsWithChildren, memo } from 'react';

const useStyles = createStyles(
  ({ css, token }) => css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;

    min-height: 0;
    padding-block: 8px;
    padding-inline: 6px;

    background: ${token.colorBgLayout};

    > * {
      flex: none;
    }
  `,
);

const PanelBody = memo<PropsWithChildren>(({ children }) => {
  const { styles } = useStyles();

  return (
    <ScrollShadow className={styles} flex={1} size={8} style={{ minHeight: 0 }}>
      {children}
    </ScrollShadow>
  );
});

export default PanelBody;
