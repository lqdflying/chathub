'use client';

import { ActionIcon } from '@lobehub/ui';
import { App, Image, Input, Tooltip, Typography } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import { Check, Copy, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    overflow: hidden;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  footer: css`
    gap: 6px;
    padding-block: 6px;
    padding-inline: 10px;
  `,
  media: css`
    display: block;

    width: 100%;
    height: 112px;

    object-fit: cover;
    background: ${token.colorBgLayout};
  `,
  previewImage: css`
    cursor: zoom-in;
  `,
  timestamp: css`
    padding-block: 0 4px;
    padding-inline: 10px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
  urlInput: css`
    flex: 1;
    font-size: 12px;
  `,
}));

interface MediaCardProps {
  createdAt: Date;
  fileType: string;
  id: string;
  name: string;
  onDelete: (id: string) => void;
  url: string;
}

const MediaCard = memo<MediaCardProps>(({ id, name, url, fileType, createdAt, onDelete }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('tools');
  const { message } = App.useApp();
  const [copied, setCopied] = useState(false);
  const isVideo = fileType.startsWith('video/');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    message.success(t('picbed.copied'));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Flexbox className={styles.card}>
      {isVideo ? (
        <video
          aria-label={name}
          className={styles.media}
          controls
          playsInline
          preload={'metadata'}
          src={url}
        />
      ) : (
        <Image
          alt={name}
          className={cx(styles.media, styles.previewImage)}
          preview={{ src: url }}
          src={url}
          wrapperStyle={{ display: 'block' }}
        />
      )}
      <Flexbox align={'center'} className={styles.footer} horizontal>
        <Input
          aria-label={t('picbed.mediaUrl')}
          className={styles.urlInput}
          readOnly
          size={'small'}
          value={url}
        />
        <Tooltip title={t('picbed.copy')}>
          <ActionIcon
            aria-label={t('picbed.copy')}
            icon={copied ? Check : Copy}
            onClick={handleCopy}
            size={{ blockSize: 26, size: 13 }}
          />
        </Tooltip>
        <Tooltip title={t('picbed.delete')}>
          <ActionIcon
            aria-label={t('picbed.delete')}
            icon={Trash2}
            onClick={() => onDelete(id)}
            size={{ blockSize: 26, size: 13 }}
          />
        </Tooltip>
      </Flexbox>
      <Typography.Text className={styles.timestamp}>
        {dayjs(createdAt).format('MMM DD YYYY HH:mm')}
      </Typography.Text>
    </Flexbox>
  );
});

export default MediaCard;
