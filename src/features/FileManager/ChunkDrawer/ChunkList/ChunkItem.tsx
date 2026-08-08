import { ChunkDisplayMetadata } from '@lobechat/types';
import { ActionIcon, Tag } from '@lobehub/ui';
import { Descriptions, Modal } from 'antd';
import { createStyles } from 'antd-style';
import { InfoIcon } from 'lucide-react';
import { ReactNode, memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useFileStore } from '@/store/file';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    flex: none;
    padding-block: 8px;
    padding-inline: 16px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
  `,
  modalBody: css`
    max-height: 60vh;
    overflow-y: auto;
  `,
  text: css`
    font-size: 14px;
    line-height: 24px;
    white-space: pre-wrap;
  `,
}));

// The DB stores a converter-specific `type` on each chunk. Map it to a
// human-facing provenance label first; fall back to `converted_by` (e.g.
// 'markitdown') or the raw type for shapes outside the known map.
export const getChunkProvenance = (type?: string | null, convertedBy?: string | null): string => {
  switch (type) {
    case 'MarkItDownElement': {
      return 'MarkItDown';
    }
    case 'LangChainElement': {
      return 'LangChain';
    }
    default: {
      return convertedBy || type || '';
    }
  }
};

interface ChunkItemProps {
  id: string;
  index: number;
  metadata: ChunkDisplayMetadata | null;
  text: string;
  type: string | null;
}

const ChunkItem = memo<ChunkItemProps>(({ text, type, id, index, metadata }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('components');
  const [open, setOpen] = useState(false);

  const highlightChunks = useFileStore((s) => s.highlightChunks);

  const provenance = useMemo(
    () => getChunkProvenance(type, metadata?.converted_by),
    [type, metadata?.converted_by],
  );

  const metaItems = useMemo(
    () =>
      [
        metadata?.converted_by && {
          children: metadata.converted_by,
          key: 'converted_by',
          label: t('FileManager.chunkDetail.convertedBy'),
        },
        type && {
          children: type,
          key: 'type',
          label: t('FileManager.chunkDetail.type'),
        },
        metadata?.source_file_type && {
          children: metadata.source_file_type,
          key: 'source_file_type',
          label: t('FileManager.chunkDetail.sourceFileType'),
        },
        metadata?.source_title && {
          children: metadata.source_title,
          key: 'source_title',
          label: t('FileManager.chunkDetail.sourceTitle'),
        },
      ].filter(Boolean) as { children: ReactNode; key: string; label: string }[],
    [metadata, type, t],
  );

  return (
    <>
      <Flexbox
        align={'center'}
        className={styles.container}
        distribution={'space-between'}
        horizontal
        onMouseEnter={() => {
          highlightChunks([id]);
        }}
        onMouseLeave={() => {
          highlightChunks([]);
        }}
      >
        <Flexbox align={'center'} gap={8} horizontal>
          <Tag bordered={false}>{t('FileManager.chunkDetail.title', { index: index + 1 })}</Tag>
          {provenance && (
            <Tag bordered={false} color={type === 'MarkItDownElement' ? 'geekblue' : 'default'}>
              {provenance}
            </Tag>
          )}
        </Flexbox>
        <ActionIcon
          aria-label={t('FileManager.chunkDetail.title', { index: index + 1 })}
          icon={InfoIcon}
          onClick={() => {
            setOpen(true);
          }}
          size={'small'}
          title={t('FileManager.chunkDetail.title', { index: index + 1 })}
        />
      </Flexbox>

      <Modal
        footer={null}
        onCancel={() => {
          setOpen(false);
        }}
        open={open}
        title={t('FileManager.chunkDetail.title', { index: index + 1 })}
        width={720}
      >
        <Flexbox className={styles.modalBody} gap={16}>
          {metaItems.length > 0 && <Descriptions column={1} items={metaItems} size={'small'} />}
          <div className={styles.text}>{text}</div>
        </Flexbox>
      </Modal>
    </>
  );
});

export default ChunkItem;
