'use client';

import { ActionIcon, Icon, Tag } from '@lobehub/ui';
import type { DescriptionsProps } from 'antd';
import { Descriptions, Divider } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import { BoltIcon, DownloadIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FileListItem } from '@/types/files';
import { downloadFile } from '@/utils/client/downloadFile';
import { formatSize } from '@/utils/format';

interface FileBasicInfoProps {
  file: FileListItem;
  variant?: 'compact' | 'panel';
}

const useStyles = createStyles(({ css, token }) => ({
  compact: css`
    flex-shrink: 0;
    overflow: hidden;
    border-radius: ${token.borderRadius}px;
    background: ${token.colorBgContainer};

    .ant-descriptions-header {
      margin-block-end: 8px;
      padding-inline: 4px;
    }

    .ant-descriptions-title {
      font-size: ${token.fontSize}px;
    }

    .ant-descriptions-item-label,
    .ant-descriptions-item-content {
      padding: 8px 10px !important;
    }

    .ant-descriptions-item-content {
      min-width: 0;
      overflow-wrap: anywhere;
    }
  `,
}));

const FileBasicInfo = memo<FileBasicInfoProps>(({ file, variant = 'panel' }) => {
  const { t } = useTranslation('file');
  const { styles } = useStyles();
  const { chunkCount, createdAt, embeddingStatus, name, size, updatedAt, url } = file;
  const isCompact = variant === 'compact';

  const downloadAction = url ? (
    <ActionIcon
      icon={DownloadIcon}
      onClick={() => {
        downloadFile(url, name);
      }}
      title={t('download', { ns: 'common' })}
    />
  ) : undefined;

  const basicItems = useMemo<DescriptionsProps['items']>(
    () => [
      { children: name, key: 'name', label: t('detail.basic.filename') },
      { children: formatSize(size), key: 'size', label: t('detail.basic.size') },
      {
        children: name.split('.').pop()?.toUpperCase(),
        key: 'type',
        label: t('detail.basic.type'),
      },
      {
        children: dayjs(createdAt).format('YYYY-MM-DD HH:mm'),
        key: 'createdAt',
        label: t('detail.basic.createdAt'),
      },
      {
        children: dayjs(updatedAt).format('YYYY-MM-DD HH:mm'),
        key: 'updatedAt',
        label: t('detail.basic.updatedAt'),
      },
    ],
    [createdAt, name, size, t, updatedAt],
  );

  const dataItems = useMemo<DescriptionsProps['items']>(
    () => [
      {
        children: (
          <Tag bordered={false} icon={<Icon icon={BoltIcon} />}>
            {chunkCount ?? 0}
          </Tag>
        ),
        key: 'chunkCount',
        label: t('detail.data.chunkCount'),
      },
      {
        children: (
          <Tag bordered={false} color={embeddingStatus || 'default'}>
            {t(`detail.data.embedding.${embeddingStatus || 'default'}`)}
          </Tag>
        ),
        key: 'embeddingStatus',
        label: t('detail.data.embeddingStatus'),
      },
    ],
    [chunkCount, embeddingStatus, t],
  );

  if (isCompact) {
    return (
      <Descriptions
        bordered
        className={styles.compact}
        colon={false}
        column={{ lg: 4, md: 3, sm: 2, xl: 4, xs: 1, xxl: 4 }}
        extra={downloadAction}
        items={[...(basicItems || []), ...(dataItems || [])]}
        layout={'vertical'}
        size={'small'}
        title={t('detail.basic.title')}
      />
    );
  }

  return (
    <>
      <Descriptions
        colon={false}
        column={1}
        extra={downloadAction}
        items={basicItems}
        labelStyle={{ width: 120 }}
        size={'small'}
        title={t('detail.basic.title')}
      />
      <Divider />
      <Descriptions
        colon={false}
        column={1}
        items={dataItems}
        labelStyle={{ width: 120 }}
        size={'small'}
      />
    </>
  );
});

export default FileBasicInfo;
