import { CodeInterpreterFileItem } from '@lobechat/types';
import { ActionIcon, MaterialFileTypeIcon, Text } from '@lobehub/ui';
import { App, Image, Input, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { Check, Copy, Download } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { fileService } from '@/services/file';
import { useChatStore } from '@/store/chat';
import { downloadFile } from '@/utils/client/downloadFile';

const IMAGE_EXT = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const VIDEO_EXT = /\.(mov|mp4|ogg|webm)$/i;

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    overflow: hidden;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  filename: css`
    min-width: 0;
    padding-block: 8px 0;
    padding-inline: 10px;
  `,
  footer: css`
    gap: 6px;
    min-width: 0;
    padding-block: 6px;
    padding-inline: 10px 8px;
    padding-block-end: 10px;
  `,
  media: css`
    display: block;

    width: 100%;
    height: 180px;

    object-fit: contain;
    background: ${token.colorBgLayout};
  `,
  placeholder: css`
    display: flex;
    gap: ${token.marginXS}px;
    align-items: center;
    justify-content: center;

    height: 96px;
    padding-inline: 12px;

    background: ${token.colorBgLayout};
  `,
  previewImage: css`
    cursor: zoom-in;
  `,
  urlInput: css`
    flex: 1;
    min-width: 0;
    font-size: 12px;
  `,
}));

const basename = (filename: string) => filename.replaceAll('\\', '/').split('/').pop() || filename;

const ResultFileCard = memo<CodeInterpreterFileItem>(({ filename, fileId, previewUrl, url }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('tool');
  const { message } = App.useApp();
  const [copied, setCopied] = useState(false);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [useFetchInterpreterFileItem] = useChatStore((s) => [s.useFetchInterpreterFileItem]);
  const { data } = useFetchInterpreterFileItem(fileId);

  const baseName = basename(data?.filename ?? filename);
  const resolvedUrl = url || data?.url || previewUrl;
  const isImage = IMAGE_EXT.test(baseName);
  const isVideo = VIDEO_EXT.test(baseName);

  useEffect(() => {
    if (!previewUrl?.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    },
    [],
  );

  const resolveDownloadUrl = async () => {
    if (resolvedUrl) return resolvedUrl;
    if (!fileId) return;
    const item = await fileService.getFile(fileId);
    return item.url;
  };

  const handleCopy = async () => {
    try {
      const copyUrl = await resolveDownloadUrl();
      if (!copyUrl) return;
      await navigator.clipboard.writeText(copyUrl);
      setCopied(true);
      message.success(t('codeInterpreter.copied'));
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      message.error(t('codeInterpreter.copyFailed'));
    }
  };

  const handleDownload = async () => {
    const downloadUrl = await resolveDownloadUrl();
    if (!downloadUrl) return;
    await downloadFile(downloadUrl, baseName);
  };

  return (
    <Flexbox className={styles.card}>
      {isVideo && resolvedUrl ? (
        <video
          aria-label={baseName}
          className={styles.media}
          controls
          playsInline
          preload={'metadata'}
          src={resolvedUrl}
        />
      ) : isImage && resolvedUrl ? (
        <Image
          alt={baseName}
          className={cx(styles.media, styles.previewImage)}
          preview={{ src: resolvedUrl }}
          src={resolvedUrl}
          wrapperStyle={{ display: 'block' }}
        />
      ) : (
        <div className={styles.placeholder}>
          <MaterialFileTypeIcon filename={baseName} size={32} type="file" />
        </div>
      )}
      <Text className={styles.filename} ellipsis>
        {baseName}
      </Text>
      <Flexbox align={'center'} className={styles.footer} horizontal>
        <Input
          aria-label={t('codeInterpreter.fileUrl')}
          className={styles.urlInput}
          readOnly
          size={'small'}
          value={resolvedUrl ?? ''}
        />
        <Tooltip title={t('codeInterpreter.copy')}>
          <ActionIcon
            aria-label={t('codeInterpreter.copy')}
            icon={copied ? Check : Copy}
            onClick={handleCopy}
            size={{ blockSize: 26, size: 13 }}
          />
        </Tooltip>
        <Tooltip title={t('codeInterpreter.download')}>
          <ActionIcon
            aria-label={t('codeInterpreter.download')}
            icon={Download}
            onClick={handleDownload}
            size={{ blockSize: 26, size: 13 }}
          />
        </Tooltip>
      </Flexbox>
    </Flexbox>
  );
});

export { ResultFileCard };
export default ResultFileCard;
