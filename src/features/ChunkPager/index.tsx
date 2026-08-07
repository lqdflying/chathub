'use client';

import { ActionIcon, Markdown } from '@lobehub/ui';
import { useSize } from 'ahooks';
import { Flex, Pagination } from 'antd';
import { createStyles } from 'antd-style';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const useStyles = createStyles(({ css, token }) => ({
  body: css`
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding-block: 16px 80px;
    padding-inline: 24px;
  `,
  bodyMedium: css`
    padding-inline: 18px;
  `,
  bodyNarrow: css`
    padding-block-start: 12px;
    padding-inline: 12px;
  `,
  markdown: css`
    min-width: 0;
    overflow-wrap: anywhere;

    table {
      display: block;
      overflow-x: auto;
      max-width: 100%;
      white-space: nowrap;
    }
  `,
  markdownMedium: css`
    font-size: 14px;
    line-height: 1.65;
  `,
  markdownNarrow: css`
    font-size: 13px;
    line-height: 1.6;

    h1 {
      font-size: 1.65em;
    }

    h2 {
      font-size: 1.4em;
    }

    h3 {
      font-size: 1.2em;
    }

    th,
    td {
      padding-block: 6px;
      padding-inline: 8px;
    }
  `,
  pager: css`
    flex-shrink: 0;
    min-width: 0;
    overflow: hidden;
    padding-block: 12px;
    padding-inline: 16px;
    border-block-start: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    white-space: nowrap;

    .ant-pagination {
      display: flex;
      flex-wrap: nowrap;
      min-width: 0;
    }

    .ant-pagination-item,
    .ant-pagination-jump-next,
    .ant-pagination-jump-prev,
    .ant-pagination-next,
    .ant-pagination-options,
    .ant-pagination-prev,
    .ant-pagination-simple-pager {
      flex: none;
    }
  `,
  pagerNarrow: css`
    padding-inline: 8px;
  `,
  root: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  `,
}));

export interface ChunkPagerItem {
  id: string;
  text: string;
}

interface ChunkPagerProps {
  chunks: ChunkPagerItem[];
  initialIndex?: number;
  onPageChange?: (page: number) => void;
}

const ChunkPager = memo<ChunkPagerProps>(({ chunks, initialIndex = 0, onPageChange }) => {
  const { cx, styles } = useStyles();
  const { t } = useTranslation('components');
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootSize = useSize(rootRef);
  const safeInitialIndex = Math.min(Math.max(initialIndex, 0), Math.max(chunks.length - 1, 0));
  const [page, setPage] = useState(safeInitialIndex + 1);
  const total = chunks.length;
  const effectivePage = Math.min(Math.max(page, 1), Math.max(total, 1));
  const currentChunk = chunks[effectivePage - 1];
  const containerWidth = rootSize?.width ?? 560;
  const isNarrow = containerWidth < 380;
  const isWide = containerWidth >= 560;
  const isMedium = !isNarrow && !isWide;

  useEffect(() => {
    setPage((currentPage) => Math.min(Math.max(currentPage, 1), Math.max(total, 1)));
  }, [total]);

  const changePage = useCallback(
    (nextPage: number) => {
      setPage(nextPage);
      onPageChange?.(nextPage);
      scrollRef.current?.scrollTo({ behavior: 'smooth', top: 0 });
    },
    [onPageChange],
  );

  if (!currentChunk) return null;

  return (
    <div
      className={styles.root}
      data-pager-density={isNarrow ? 'narrow' : isWide ? 'wide' : 'medium'}
      ref={rootRef}
    >
      <div
        className={cx(styles.body, isMedium && styles.bodyMedium, isNarrow && styles.bodyNarrow)}
        ref={scrollRef}
      >
        <Markdown
          className={cx(
            styles.markdown,
            isMedium && styles.markdownMedium,
            isNarrow && styles.markdownNarrow,
          )}
        >
          {currentChunk.text}
        </Markdown>
      </div>
      {total > 1 && (
        <Flex
          align={'center'}
          className={cx(styles.pager, isNarrow && styles.pagerNarrow)}
          gap={isNarrow ? 4 : 8}
          justify={'center'}
          wrap={false}
        >
          <ActionIcon
            aria-label={t('chunkPager.first')}
            disabled={effectivePage === 1}
            icon={ChevronsLeft}
            onClick={() => changePage(1)}
            size={{ blockSize: isNarrow ? 28 : 32, size: 16 }}
            title={t('chunkPager.first')}
          />
          <Pagination
            current={effectivePage}
            defaultPageSize={1}
            onChange={changePage}
            pageSize={1}
            showLessItems={!isWide}
            showQuickJumper={isWide}
            showSizeChanger={false}
            showTitle={false}
            simple={isNarrow}
            size={'small'}
            total={total}
          />
          <ActionIcon
            aria-label={t('chunkPager.last')}
            disabled={effectivePage === total}
            icon={ChevronsRight}
            onClick={() => changePage(total)}
            size={{ blockSize: isNarrow ? 28 : 32, size: 16 }}
            title={t('chunkPager.last')}
          />
        </Flex>
      )}
    </div>
  );
});

ChunkPager.displayName = 'ChunkPager';

export default ChunkPager;
