import { Tag } from '@lobehub/ui';
import { Descriptions, Modal } from 'antd';
import { createStyles } from 'antd-style';
import { ReactNode, memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useFileStore } from '@/store/file';
import { FileChunk } from '@/types/chunk';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    padding-block: 12px;
    padding-inline: 8px;
    border-block-end: 1px dashed ${token.colorBorderSecondary};
    border-radius: 4px;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  content: css`
    cursor: pointer;
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
  title: css`
    font-size: 18px;
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

type ChunkItemProps = FileChunk;

const ChunkItem = memo<ChunkItemProps>(({ text, type, id, index, metadata }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('components');
  const [open, setOpen] = useState(false);

  const highlightChunks = useFileStore((s) => s.highlightChunks);

  const provenance = useMemo(
    () => getChunkProvenance(type, metadata?.converted_by),
    [type, metadata?.converted_by],
  );

  const typeClassName = useMemo(() => {
    switch (type) {
      default: {
        return styles.text;
      }
      case 'Title': {
        return styles.title;
      }
    }
  }, [type]);

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
        className={cx(styles.container, typeClassName)}
        gap={6}
        onMouseEnter={() => {
          highlightChunks([id]);
        }}
        onMouseLeave={() => {
          highlightChunks([]);
        }}
      >
        {provenance && (
          <Flexbox>
            <Tag bordered={false} color={type === 'MarkItDownElement' ? 'geekblue' : 'default'}>
              {provenance}
            </Tag>
          </Flexbox>
        )}
        <div
          className={styles.content}
          onClick={() => {
            setOpen(true);
          }}
        >
          {text}
        </div>
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
