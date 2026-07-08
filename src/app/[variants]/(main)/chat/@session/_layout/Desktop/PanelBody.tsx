'use client';

import { ScrollShadow } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { PropsWithChildren, memo } from 'react';

const useStyles = createStyles(
  ({ css, token }) => css`
    display: flex;
    flex-direction: column;
    gap: 3px;

    padding-block: 8px;
    padding-inline: 6px;

    background:
      linear-gradient(180deg, ${token.colorBgLayout} 0%, ${token.colorBgContainerSecondary} 100%);
  `,
);

const PanelBody = memo<PropsWithChildren>(({ children }) => {
  const { styles } = useStyles();

  return (
    <ScrollShadow className={styles} size={8}>
      {children}
    </ScrollShadow>
  );
});

export default PanelBody;
