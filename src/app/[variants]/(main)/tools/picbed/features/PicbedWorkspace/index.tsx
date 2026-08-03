'use client';

import { ActionIcon, Icon } from '@lobehub/ui';
import { App, Empty, Image, Pagination, Spin, Typography, Upload, type UploadProps } from 'antd';
import { createStyles } from 'antd-style';
import { ChevronsLeft, ChevronsRight, CloudUpload } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useIsMobile } from '@/hooks/useIsMobile';
import { picbedService } from '@/services/picbed';
import { sensitiveAccountScope } from '@/store/accountMutation';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import MediaCard from './MediaCard';
import { usePicbedUpload } from './usePicbedUpload';

const useStyles = createStyles(({ css, token }) => ({
  desktopUploadCopy: css`
    @media (max-width: 600px) {
      display: none;
    }
  `,
  dropZone: css`
    box-sizing: border-box;
    cursor: pointer;

    width: 100%;
    min-width: 0;
    padding-block: 40px;
    padding-inline: 24px;
    border: 2px dashed ${token.colorBorder};
    border-radius: ${token.borderRadiusLG}px;

    text-align: center;
    overflow-wrap: anywhere;

    :global(.ant-upload-drag-container) {
      min-width: 0;
    }

    @media (max-width: 600px) {
      padding-block: 24px;
      padding-inline: 8px;
    }

    transition:
      border-color 0.2s,
      background 0.2s;

    &:hover,
    &.dragging {
      border-color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(154px, 100%), 1fr));
    gap: 12px;
  `,
  mobileUploadCopy: css`
    display: none;

    @media (max-width: 600px) {
      display: inline;
    }
  `,
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

    @media (max-width: 600px) {
      gap: 4px;
    }
  `,
  title: css`
    margin-block-end: 0 !important;
  `,
}));

interface PicbedMediaRecord {
  createdAt: Date;
  fileType: string;
  id: string;
  name: string;
  size: number;
  url: string;
}

interface PicbedWorkspaceContentProps {
  requestedScope: string | undefined;
}

const PAGE_SIZE = 20;

const PicbedWorkspaceContent = memo<PicbedWorkspaceContentProps>(({ requestedScope }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('tools');
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const galleryRef = useRef<HTMLDivElement>(null);
  const [media, setMedia] = useState<PicbedMediaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const loadMedia = useCallback(async () => {
    const scopeAtRequestStart = requestedScope;
    if (!scopeAtRequestStart) {
      setMedia([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const list = await picbedService.list();
      if (authSelectors.currentUserScope(useUserStore.getState()) !== scopeAtRequestStart) return;

      setMedia(list as PicbedMediaRecord[]);
    } finally {
      if (authSelectors.currentUserScope(useUserStore.getState()) === scopeAtRequestStart) {
        setLoading(false);
      }
    }
  }, [requestedScope]);

  const handleUploadSuccess = useCallback(() => {
    setPage(1);
    void loadMedia();
  }, [loadMedia]);

  const { isDragging, stopDragging, uploadFiles, uploading } = usePicbedUpload(
    requestedScope,
    handleUploadSuccess,
  );

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  const handleUpload = (files: File[]) => {
    void uploadFiles(files);
  };

  const totalPages = Math.max(1, Math.ceil(media.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedMedia = media.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  const handlePageChange = useCallback(
    (nextPage: number) => {
      const clampedPage = Math.min(Math.max(nextPage, 1), totalPages);
      if (clampedPage === currentPage) return;

      setPage(clampedPage);
      galleryRef.current?.scrollIntoView?.({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
        block: 'start',
      });
    },
    [currentPage, totalPages],
  );

  const handleDelete = async (id: string) => {
    const scopeAtRequestStart = requestedScope;
    try {
      await picbedService.delete(id);
      if (authSelectors.currentUserScope(useUserStore.getState()) !== scopeAtRequestStart) return;

      setMedia((prev) => prev.filter((item) => item.id !== id));
      message.success(t('picbed.deleted'));
    } catch {
      if (authSelectors.currentUserScope(useUserStore.getState()) === scopeAtRequestStart) {
        message.error(t('picbed.deleteFailed'));
      }
    }
  };

  const handleFileSelect: UploadProps['beforeUpload'] = (file, fileList) => {
    if (file.uid === fileList[0]?.uid) handleUpload(fileList);
    return false;
  };

  return (
    <Flexbox gap={24}>
      <Typography.Title className={styles.title} level={4}>
        {t('picbed.title')}
      </Typography.Title>

      <Upload.Dragger
        accept={'image/*,video/*'}
        aria-label={t('picbed.upload')}
        beforeUpload={handleFileSelect}
        className={cx(styles.dropZone, isDragging && 'dragging')}
        multiple
        onDrop={(event) => {
          event.stopPropagation();
          stopDragging();
        }}
        showUploadList={false}
      >
        <Spin spinning={uploading}>
          <Flexbox align={'center'} gap={8}>
            <Icon icon={CloudUpload} size={32} />
            <Typography.Text className={styles.desktopUploadCopy} type={'secondary'}>
              {t('picbed.upload')}
            </Typography.Text>
            <Typography.Text className={styles.mobileUploadCopy} type={'secondary'}>
              {t('picbed.uploadShort')}
            </Typography.Text>
            <Typography.Text
              className={styles.desktopUploadCopy}
              style={{ fontSize: 12 }}
              type={'secondary'}
            >
              {t('picbed.dragTip')}
            </Typography.Text>
          </Flexbox>
        </Spin>
      </Upload.Dragger>

      {loading ? (
        <Flexbox align={'center'} justify={'center'} padding={40}>
          <Spin />
        </Flexbox>
      ) : media.length === 0 ? (
        <Empty description={t('picbed.empty')} />
      ) : (
        <>
          <Image.PreviewGroup>
            <div className={styles.grid} ref={galleryRef}>
              {pagedMedia.map((item) => (
                <MediaCard
                  createdAt={item.createdAt}
                  fileType={item.fileType}
                  id={item.id}
                  key={item.id}
                  name={item.name}
                  onDelete={handleDelete}
                  url={item.url}
                />
              ))}
            </div>
          </Image.PreviewGroup>
          {media.length > PAGE_SIZE && (
            <Flexbox
              align={'center'}
              className={styles.paginationBar}
              gap={8}
              horizontal
              justify={'center'}
              wrap={isMobile ? 'nowrap' : 'wrap'}
            >
              <ActionIcon
                aria-label={t('picbed.firstPage')}
                disabled={currentPage === 1}
                icon={ChevronsLeft}
                onClick={() => handlePageChange(1)}
                size={{ blockSize: 44, size: 18 }}
                title={t('picbed.firstPage')}
              />
              <Pagination
                className={styles.pagination}
                current={currentPage}
                onChange={handlePageChange}
                pageSize={PAGE_SIZE}
                showQuickJumper={!isMobile}
                showSizeChanger={false}
                showTotal={isMobile ? undefined : (total) => t('picbed.total', { count: total })}
                simple={isMobile}
                total={media.length}
              />
              <ActionIcon
                aria-label={t('picbed.lastPage')}
                disabled={currentPage === totalPages}
                icon={ChevronsRight}
                onClick={() => handlePageChange(totalPages)}
                size={{ blockSize: 44, size: 18 }}
                title={t('picbed.lastPage')}
              />
            </Flexbox>
          )}
        </>
      )}
    </Flexbox>
  );
});

const PicbedWorkspace = memo(() => {
  const requestedScope = useUserStore(sensitiveAccountScope);

  return (
    <PicbedWorkspaceContent
      key={requestedScope || 'unresolved-user'}
      requestedScope={requestedScope}
    />
  );
});

export default PicbedWorkspace;
