'use client';

import { Icon } from '@lobehub/ui';
import { App, Empty, Image, Pagination, Spin, Typography, Upload } from 'antd';
import { createStyles } from 'antd-style';
import { ImageUp } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { picbedService } from '@/services/picbed';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import ImageCard from './ImageCard';
import { usePicbedUpload } from './usePicbedUpload';

const useStyles = createStyles(({ css, token }) => ({
  dropZone: css`
    cursor: pointer;

    padding-block: 40px;
    padding-inline: 24px;
    border: 2px dashed ${token.colorBorder};
    border-radius: ${token.borderRadiusLG}px;

    text-align: center;

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
    grid-template-columns: repeat(auto-fill, minmax(154px, 1fr));
    gap: 12px;
  `,
  title: css`
    margin-block-end: 0 !important;
  `,
}));

interface ImageRecord {
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

const PicbedWorkspaceContent = memo<PicbedWorkspaceContentProps>(({ requestedScope }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('tools');
  const { message } = App.useApp();
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const loadImages = useCallback(async () => {
    const scopeAtRequestStart = requestedScope;
    if (!scopeAtRequestStart) {
      setImages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const list = await picbedService.list();
      if (authSelectors.currentUserScope(useUserStore.getState()) !== scopeAtRequestStart) return;

      setImages(list as ImageRecord[]);
    } finally {
      if (authSelectors.currentUserScope(useUserStore.getState()) === scopeAtRequestStart) {
        setLoading(false);
      }
    }
  }, [requestedScope]);

  const { isDragging, uploadFiles, uploading } = usePicbedUpload(requestedScope, loadImages);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  const handleUpload = async (files: File[]) => {
    const scopeAtRequestStart = requestedScope;
    const results = await uploadFiles(files);
    if (results && authSelectors.currentUserScope(useUserStore.getState()) === scopeAtRequestStart) {
      setPage(1);
      void loadImages();
    }
  };

  const pagedImages = images.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleDelete = async (id: string) => {
    const scopeAtRequestStart = requestedScope;
    await picbedService.delete(id);
    if (authSelectors.currentUserScope(useUserStore.getState()) !== scopeAtRequestStart) return;

    setImages((prev) => prev.filter((img) => img.id !== id));
    message.success(t('picbed.delete'));
  };

  const handleFileSelect = (file: File) => {
    void handleUpload([file]);
    return false;
  };

  return (
    <Flexbox gap={24}>
      <Typography.Title className={styles.title} level={4}>
        {t('picbed.title')}
      </Typography.Title>

      <Upload.Dragger
        accept={'image/*'}
        beforeUpload={handleFileSelect}
        className={cx(styles.dropZone, isDragging && 'dragging')}
        showUploadList={false}
      >
        <Spin spinning={uploading}>
          <Flexbox align={'center'} gap={8}>
            <Icon icon={ImageUp} size={32} />
            <Typography.Text type={'secondary'}>{t('picbed.upload')}</Typography.Text>
            <Typography.Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('picbed.dragTip')}
            </Typography.Text>
          </Flexbox>
        </Spin>
      </Upload.Dragger>

      {loading ? (
        <Flexbox align={'center'} justify={'center'} padding={40}>
          <Spin />
        </Flexbox>
      ) : images.length === 0 ? (
        <Empty description={t('picbed.empty')} />
      ) : (
        <>
          <Image.PreviewGroup>
            <div className={styles.grid}>
              {pagedImages.map((img) => (
                <ImageCard
                  createdAt={img.createdAt}
                  id={img.id}
                  key={img.id}
                  name={img.name}
                  onDelete={handleDelete}
                  url={img.url}
                />
              ))}
            </div>
          </Image.PreviewGroup>
          {images.length > PAGE_SIZE && (
            <Flexbox align={'center'}>
              <Pagination
                current={page}
                onChange={setPage}
                pageSize={PAGE_SIZE}
                showSizeChanger={false}
                showTotal={(total) => `${total} images`}
                total={images.length}
              />
            </Flexbox>
          )}
        </>
      )}
    </Flexbox>
  );
});

const PicbedWorkspace = memo(() => {
  const requestedScope = useUserStore(authSelectors.currentUserScope);

  return (
    <PicbedWorkspaceContent
      key={requestedScope || 'unresolved-user'}
      requestedScope={requestedScope}
    />
  );
});

export default PicbedWorkspace;
