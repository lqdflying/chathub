'use client';

import type { ImageArtifactItem } from '@lobechat/types';
import { ActionIcon } from '@lobehub/ui';
import { useDebounce } from 'ahooks';
import {
  Button,
  Empty,
  Image,
  Input,
  Pagination,
  Result,
  Select,
  Skeleton,
  Typography,
} from 'antd';
import { createStyles } from 'antd-style';
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useIsMobile } from '@/hooks/useIsMobile';
import { artifactService } from '@/services/artifacts';
import { sensitiveAccountScope } from '@/store/accountMutation';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';

import ArtifactCard from './ArtifactCard';

const PAGE_SIZE = 40;

const useStyles = createStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
    gap: 16px;

    @media (max-width: 767px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
  `,
  header: css`
    min-width: 0;
  `,
  pagination: css`
    min-width: 0;

    :global(.ant-pagination-prev),
    :global(.ant-pagination-next) {
      min-width: 44px;
      height: 44px;
    }

    :global(.ant-pagination-item),
    :global(.ant-pagination-item-link) {
      height: 44px;
      line-height: 42px;
    }

    @media (max-width: 767px) {
      :global(.ant-pagination-simple-pager) {
        height: 44px;
        line-height: 44px;
      }

      :global(.ant-pagination-simple-pager input) {
        height: 44px;
      }
    }
  `,
  toolbar: css`
    min-width: 0;

    @media (max-width: 767px) {
      align-items: stretch;
      flex-direction: column;
    }
  `,
}));

interface ArtifactsWorkspaceContentProps {
  requestedScope: string | undefined;
}

const ArtifactSkeleton = memo(() => (
  <Flexbox gap={8}>
    <Skeleton.Image active style={{ aspectRatio: 1, height: 'auto', width: '100%' }} />
    <Skeleton active paragraph={{ rows: 1 }} title={false} />
  </Flexbox>
));

const ArtifactsWorkspaceContent = memo<ArtifactsWorkspaceContentProps>(({ requestedScope }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('artifacts');
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const isMobile = useIsMobile();
  const [items, setItems] = useState<ImageArtifactItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const debouncedQuery = useDebounce(query, { wait: 300 });
  const galleryRef = useRef<HTMLDivElement>(null);
  const filterKey = JSON.stringify([debouncedQuery, sort]);
  const appliedFilterKeyRef = useRef(filterKey);
  const requestIdRef = useRef(0);
  const effectivePage = appliedFilterKeyRef.current === filterKey ? page : 1;

  useEffect(() => {
    if (appliedFilterKeyRef.current === filterKey) return;

    appliedFilterKeyRef.current = filterKey;
    setPage(1);
  }, [filterKey]);

  const loadArtifacts = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const scopeAtRequestStart = requestedScope;
    const isCurrentRequest = () =>
      requestIdRef.current === requestId &&
      sensitiveAccountScope(useUserStore.getState()) === scopeAtRequestStart;

    if (!scopeAtRequestStart) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);
    try {
      const result = await artifactService.list({
        page: effectivePage,
        pageSize: PAGE_SIZE,
        q: debouncedQuery || undefined,
        sort,
      });

      if (!isCurrentRequest()) return;
      setItems(result.items);
      setTotal(result.total);
    } catch {
      if (isCurrentRequest()) setError(true);
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [debouncedQuery, effectivePage, requestedScope, sort]);

  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(effectivePage, totalPages);
  const handlePageChange = useCallback(
    (nextPage: number) => {
      const clampedPage = Math.min(Math.max(nextPage, 1), totalPages);
      if (clampedPage === currentPage) return;
      setPage(clampedPage);
      galleryRef.current?.scrollIntoView({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
        block: 'start',
      });
    },
    [currentPage, totalPages],
  );

  const sortOptions = useMemo(
    () => [
      { label: t('sort.newest'), value: 'newest' },
      { label: t('sort.oldest'), value: 'oldest' },
    ],
    [t],
  );

  return (
    <Flexbox gap={24} width={'100%'}>
      <Flexbox className={styles.header} gap={16}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('title')}
        </Typography.Title>
        <Flexbox className={styles.toolbar} gap={12} horizontal>
          <Input
            allowClear
            aria-label={t('search.label')}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search.placeholder')}
            prefix={<Search size={18} />}
            size={'large'}
            value={query}
          />
          <Select
            aria-label={t('sort.label')}
            onChange={(value) => setSort(value as 'newest' | 'oldest')}
            options={sortOptions}
            size={'large'}
            style={{ minWidth: 150 }}
            value={sort}
          />
        </Flexbox>
      </Flexbox>

      {error ? (
        <Result
          extra={
            <Button
              aria-label={t('retry')}
              icon={<RefreshCw size={16} />}
              onClick={() => {
                void loadArtifacts();
              }}
              type={'primary'}
            >
              {t('retry')}
            </Button>
          }
          status="warning"
          subTitle={t('loadFailed')}
        />
      ) : loading ? (
        <div className={styles.grid}>
          {Array.from({ length: 8 }, (_, index) => (
            <ArtifactSkeleton key={index} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty description={t('empty')} />
      ) : (
        <>
          <Image.PreviewGroup>
            <div className={styles.grid} ref={galleryRef}>
              {items.map((artifact) => (
                <ArtifactCard artifact={artifact} key={artifact.id} locale={locale} />
              ))}
            </div>
          </Image.PreviewGroup>
          {total > PAGE_SIZE && (
            <Flexbox align={'center'} gap={8} horizontal justify={'center'} wrap={'wrap'}>
              <ActionIcon
                aria-label={t('pagination.previous')}
                disabled={currentPage === 1}
                icon={ChevronLeft}
                onClick={() => handlePageChange(currentPage - 1)}
                size={{ blockSize: 44, size: 18 }}
                title={t('pagination.previous')}
              />
              <Pagination
                className={styles.pagination}
                current={currentPage}
                onChange={handlePageChange}
                pageSize={PAGE_SIZE}
                showQuickJumper={!isMobile}
                showSizeChanger={false}
                showTotal={isMobile ? undefined : (count) => t('pagination.total', { count })}
                simple={isMobile}
                total={total}
              />
              <ActionIcon
                aria-label={t('pagination.next')}
                disabled={currentPage === totalPages}
                icon={ChevronRight}
                onClick={() => handlePageChange(currentPage + 1)}
                size={{ blockSize: 44, size: 18 }}
                title={t('pagination.next')}
              />
            </Flexbox>
          )}
        </>
      )}
    </Flexbox>
  );
});

const ArtifactsWorkspace = memo(() => {
  const requestedScope = useUserStore(sensitiveAccountScope);

  return (
    <ArtifactsWorkspaceContent
      key={requestedScope || 'unresolved-user'}
      requestedScope={requestedScope}
    />
  );
});

ArtifactsWorkspace.displayName = 'ArtifactsWorkspace';

export default ArtifactsWorkspace;
