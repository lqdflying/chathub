'use client';

import type { ImageArtifactItem } from '@lobechat/types';
import { ActionIcon } from '@lobehub/ui';
import { App, Image, Typography } from 'antd';
import { createStyles } from 'antd-style';
import { Download } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { downloadFile } from '@/utils/client/downloadFile';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    min-width: 0;
    overflow: hidden;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    transition:
      border-color 180ms ease-out,
      box-shadow 180ms ease-out;

    &:hover {
      border-color: ${token.colorBorder};
      box-shadow: ${token.boxShadowTertiary};
    }
  `,
  imageAction: css`
    position: absolute;
    z-index: 1;
    inset-block-end: 8px;
    inset-inline-end: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgElevated};
  `,
  imageFrame: css`
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    background: ${token.colorFillQuaternary};

    :global(.ant-image),
    :global(.ant-image-img) {
      display: block;
      width: 100%;
      height: 100%;
    }

    :global(.ant-image-img) {
      cursor: zoom-in;
      object-fit: contain;
    }
  `,
  meta: css`
    min-width: 0;
    padding: 10px 12px 12px;
  `,
  secondary: css`
    color: ${token.colorTextSecondary};
    font-size: 12px;
  `,
}));

const formatBytes = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

interface ArtifactCardProps {
  artifact: ImageArtifactItem;
  locale: string;
}

const ArtifactCard = memo<ArtifactCardProps>(({ artifact, locale }) => {
  const { styles } = useStyles();
  const { message } = App.useApp();
  const { t } = useTranslation('artifacts');
  const dimensions = useMemo(
    () =>
      artifact.width && artifact.height ? `${artifact.width} × ${artifact.height}` : undefined,
    [artifact.height, artifact.width],
  );
  const createdAt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(artifact.createdAt),
    [artifact.createdAt, locale],
  );

  const handleDownload = async () => {
    try {
      await downloadFile(artifact.url, artifact.name);
    } catch {
      message.error(t('card.downloadFailed'));
    }
  };

  return (
    <article className={styles.card} data-artifact-id={artifact.id}>
      <div className={styles.imageFrame}>
        <Image
          alt={artifact.name}
          height={'100%'}
          preview={{
            src: artifact.url,
          }}
          src={artifact.url}
          width={'100%'}
        />
        <ActionIcon
          aria-label={t('card.download')}
          className={styles.imageAction}
          icon={Download}
          onClick={handleDownload}
          size={{ blockSize: 44, size: 18 }}
          title={t('card.download')}
        />
      </div>
      <Flexbox className={styles.meta} gap={4}>
        <Typography.Text ellipsis={{ tooltip: artifact.name }} strong>
          {artifact.name}
        </Typography.Text>
        <Typography.Text
          className={styles.secondary}
          ellipsis={{
            tooltip: [dimensions, formatBytes(artifact.size), createdAt]
              .filter(Boolean)
              .join(' · '),
          }}
        >
          {[dimensions, formatBytes(artifact.size), createdAt].filter(Boolean).join(' · ')}
        </Typography.Text>
      </Flexbox>
    </article>
  );
});

ArtifactCard.displayName = 'ArtifactCard';

export default ArtifactCard;
