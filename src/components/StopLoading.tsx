import type { IconType } from '@lobehub/icons';
import { cx, useTheme } from 'antd-style';
import { forwardRef } from 'react';

import { useStyles } from './StopLoading.style';

const StopLoadingIcon: IconType = forwardRef(({ size = 16, className, style, ...rest }, ref) => {
  const theme = useTheme();
  const { styles } = useStyles();

  return (
    <svg
      className={cx('anticon', className)}
      color="currentColor"
      height={size}
      ref={ref}
      style={{ flex: 'none', lineHeight: 1, ...style }}
      viewBox="0 0 1024 1024"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <g fill="none">
        <circle cx="512" cy="512" fill="none" r="426" stroke={theme.colorBorder} strokeWidth="72" />
        <rect fill="currentColor" height="252" rx="24" ry="24" width="252" x="386" y="386" />
        <g className={styles.arc} data-testid={'chat-send-stop-arc'}>
          <path
            d="M938.667 512C938.667 276.359 747.64 85.333 512 85.333"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="73"
          />
        </g>
      </g>
    </svg>
  );
});

StopLoadingIcon.displayName = 'StopLoadingIcon';

export default StopLoadingIcon;
