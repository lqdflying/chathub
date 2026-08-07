'use client';

import { ActionIcon, Markdown } from '@lobehub/ui';
import { Pagination } from 'antd';
import { createStyles } from 'antd-style';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useIsMobile } from '@/hooks/useIsMobile';

const useStyles = createStyles(({ css, token }) => ({
  pagination: css`
    min-width: 0;

    :global(.ant-pagination-prev),
    :global(.ant-pagination-next) {
      min-width: 44px;
      height: 44px;
    }

    :global(.ant-pagination-item-link) {
      display: grid;
      place-items: center;
      height: 44px;
    }

    @media (max-width: 600px) {
      :global(.ant-pagination-simple-pager) {
        height: 44px;
        margin-inline: 4px;
        line-height: 44px;
        white-space: nowrap;
      }

      :global(.ant-pagination-simple-pager input) {
        width: 44px;
        height: 44px;
      }
    }
  `,
  paginationBar: css`
    width: 100%;
    min-width: 0;
    border-block-start: 1px solid ${token.colorBorderSecondary};
    padding-block: 8px;

    @media (max-width: 600px) {
      gap: 4px;
    }
  `,
  scroll: css`
    overflow-y: auto;
    padding-inline: 8px;
  `,
}));

export interface ChunkPagerProps {
  chunks: { id: string; text: string }[];
  initialIndex?: number;
}

const ChunkPager = memo<ChunkPagerProps>(({ chunks, initialIndex }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('portal');
  const isMobile = useIsMobile();
  const scrollRef = useRef<HTMLDivElement>(null);

  const totalPages = chunks.length;
  const initialPage = useMemo(() => {
    const idx = initialIndex ?? 0;
    return Math.min(Math.max(idx + 1, 1), totalPages);
  }, [initialIndex, totalPages]);

  const [currentPage, setCurrentPage] = useState(initialPage);

  useEffect(() => {
    // Re-clamp when the chunk list (length / initial) changes — e.g. switching tabs
    // or after the all-chunks fetch resolves.
    if (currentPage > totalPages) setCurrentPage(totalPages);
    else if (currentPage < 1 && totalPages > 0) setCurrentPage(1);
  }, [currentPage, totalPages]);

  if (!totalPages) return null;

  const currentChunk = chunks[currentPage - 1];

  const handlePageChange = useCallback(
    (nextPage: number) => {
      const clamped = Math.min(Math.max(nextPage, 1), totalPages);
      if (clamped === currentPage) return;

      setCurrentPage(clamped);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    },
    [currentPage, totalPages],
  );

  return (
    <Flexbox flex={1} gap={8} style={{ minHeight: 0 }}>
      <Flexbox ref={scrollRef} className={styles.scroll} flex={1}>
        <Markdown>{currentChunk.text}</Markdown>
      </Flexbox>
      {totalPages > 1 && (
        <Flexbox
          align={'center'}
          className={styles.paginationBar}
          gap={8}
          horizontal
          justify={'center'}
          wrap={isMobile ? 'nowrap' : 'wrap'}
        >
          <ActionIcon
            aria-label={t('FilePreview.chunkPager.first')}
            disabled={currentPage === 1}
            icon={ChevronsLeft}
            onClick={() => handlePageChange(1)}
            size={{ blockSize: 44, size: 18 }}
            title={t('FilePreview.chunkPager.first')}
          />
          <Pagination
            className={styles.pagination}
            current={currentPage}
            onChange={handlePageChange}
            pageSize={1}
            showQuickJumper={!isMobile}
            showSizeChanger={false}
            showTotal={
              isMobile
                ? undefined
                : (total) => t('FilePreview.chunkPager.total', { count: total })
            }
            simple={isMobile}
            total={totalPages}
          />
          <ActionIcon
            aria-label={t('FilePreview.chunkPager.last')}
            disabled={currentPage === totalPages}
            icon={ChevronsRight}
            onClick={() => handlePageChange(totalPages)}
            size={{ blockSize: 44, size: 18 }}
            title={t('FilePreview.chunkPager.last')}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default ChunkPager;