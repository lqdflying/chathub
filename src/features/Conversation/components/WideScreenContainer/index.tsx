'use client';

import { createStyles } from 'antd-style';
import { memo, useEffect } from 'react';
import { Flexbox, FlexboxProps } from 'react-layout-kit';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    align-self: center;

    /* Leave some space for the minimap */
    padding-inline: 12px;
    transition: width 0.25s ${token.motionEaseInOut};
  `,
}));

interface WideScreenContainerProps extends FlexboxProps {
  onChange?: () => void;
}

const WideScreenContainer = memo<WideScreenContainerProps>(
  ({ children, className, onChange, ...rest }) => {
    const { cx, styles } = useStyles();

    useEffect(() => {
      onChange?.();
    }, []);

    return (
      <Flexbox className={cx(styles.container, className)} width={'100%'} {...rest}>
        {children}
      </Flexbox>
    );
  },
);

export default WideScreenContainer;
