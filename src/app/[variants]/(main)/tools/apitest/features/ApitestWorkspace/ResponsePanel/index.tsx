'use client';

import { Divider, Tabs, Tag, Typography } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { formatSize } from '@/utils/format';

import type { ResponseState } from '../types';
import ResponseBody from './ResponseBody';
import ResponseHeaders from './ResponseHeaders';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding: 20px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  statusBar: css`
    font-size: 13px;
  `,
  statusTag: css`
    padding-block: 2px;
    padding-inline: 10px;
    font-size: 13px;
    font-weight: 600;
  `,
}));

const StatusTag = ({ className, status }: { className?: string; status: number }) => {
  if (status === 0) return null;
  const color =
    status >= 200 && status < 300 ? 'success' : status >= 300 && status < 400 ? 'warning' : 'error';
  return (
    <Tag className={className} color={color}>
      {status}
    </Tag>
  );
};

const formatBytes = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : formatSize(bytes));

interface ResponsePanelProps {
  response: ResponseState;
}

const ResponsePanel = memo<ResponsePanelProps>(({ response }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('tools');
  const [activeTab, setActiveTab] = useState('body');

  const headerCount = Object.keys(response.headers).length;

  const tabs = [
    {
      children: <ResponseBody response={response} />,
      key: 'body',
      label: t('apitest.responseBody'),
    },
    {
      children: <ResponseHeaders headers={response.headers} />,
      key: 'headers',
      label:
        headerCount > 0
          ? `${t('apitest.responseHeaders')} (${headerCount})`
          : t('apitest.responseHeaders'),
    },
  ];

  return (
    <Flexbox className={styles.card} gap={0}>
      {/* Status bar */}
      <Flexbox align={'center'} className={styles.statusBar} gap={16} horizontal>
        <StatusTag className={styles.statusTag} status={response.status} />
        {response.status > 0 && (
          <Typography.Text type={'secondary'}>{response.statusText}</Typography.Text>
        )}
        <Typography.Text type={'secondary'}>{response.time}ms</Typography.Text>
        {!response.error && (
          <Typography.Text type={'secondary'}>{formatBytes(response.size)}</Typography.Text>
        )}
      </Flexbox>

      <Divider style={{ margin: '12px 0 0' }} />

      {/* Body / Headers tabs */}
      <Tabs
        activeKey={activeTab}
        items={tabs}
        onChange={setActiveTab}
        size={'small'}
        tabBarStyle={{ marginBottom: 0 }}
      />
    </Flexbox>
  );
});

ResponsePanel.displayName = 'ResponsePanel';

export default ResponsePanel;
