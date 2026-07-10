'use client';

import { Typography } from 'antd';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

const useStyles = createStyles(({ css, token }) => ({
  item: css`
    padding-block: 6px;
    padding-inline: 0;
    border-block-end: 1px solid ${token.colorBorderSecondary};

    font-family: ${token.fontFamilyCode};
    font-size: 12px;

    &:last-child {
      border-block-end: none;
    }
  `,
  key: css`
    min-width: 200px;
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
  `,
  value: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    word-break: break-all;
  `,
}));

interface ResponseHeadersProps {
  headers: Record<string, string>;
}

const ResponseHeaders = memo<ResponseHeadersProps>(({ headers }) => {
  const { styles } = useStyles();

  return (
    <Flexbox gap={4} style={{ padding: '16px 0' }}>
      {Object.entries(headers).map(([key, value]) => (
        <Flexbox className={styles.item} gap={8} horizontal key={key}>
          <Typography.Text className={styles.key} strong>
            {key}
          </Typography.Text>
          <Typography.Text className={styles.value}>{value}</Typography.Text>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

ResponseHeaders.displayName = 'ResponseHeaders';

export default ResponseHeaders;
