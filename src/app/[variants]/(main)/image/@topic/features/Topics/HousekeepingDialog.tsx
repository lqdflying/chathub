'use client';

import { Alert, App, InputNumber, Modal, Segmented, Spin, Typography } from 'antd';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useImageStore } from '@/store/image';
import type {
  ImageHistoryHousekeepingInput,
  ImageHistoryHousekeepingPreview,
} from '@/types/generation';

interface HousekeepingDialogProps {
  onClose: () => void;
  open: boolean;
}

const DEFAULT_DAYS = 30;

const HousekeepingDialog = memo<HousekeepingDialogProps>(({ onClose, open }) => {
  const { t } = useTranslation('image');
  const { message } = App.useApp();
  const [mode, setMode] = useState<'olderThan' | 'all'>('olderThan');
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [preview, setPreview] = useState<ImageHistoryHousekeepingPreview>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const previewRequestRef = useRef(0);
  const previewHousekeeping = useImageStore((s) => s.previewGenerationTopicHousekeeping);
  const housekeep = useImageStore((s) => s.housekeepGenerationTopics);

  const input = useMemo<ImageHistoryHousekeepingInput>(
    () => (mode === 'all' ? { mode: 'all' } : { days, mode: 'olderThan' }),
    [days, mode],
  );

  useEffect(() => {
    if (!open) return;

    const requestId = ++previewRequestRef.current;
    setPreviewLoading(true);
    setPreviewFailed(false);
    const timer = window.setTimeout(async () => {
      try {
        const result = await previewHousekeeping(input);
        if (previewRequestRef.current !== requestId) return;
        setPreview(result);
      } catch (error) {
        if (previewRequestRef.current !== requestId) return;
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setPreviewFailed(true);
        }
      } finally {
        if (previewRequestRef.current === requestId) setPreviewLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [input, open, previewHousekeeping]);

  useEffect(() => {
    if (open) return;
    previewRequestRef.current += 1;
    setMode('olderThan');
    setDays(DEFAULT_DAYS);
    setPreview(undefined);
    setPreviewFailed(false);
  }, [open]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const result = await housekeep(input);
      message.success(t('topic.housekeeping.success', { count: result.deletedTopicIds.length }));
      if (result.skippedActiveTopicCount > 0) {
        message.warning(t('topic.housekeeping.skipped', { count: result.skippedActiveTopicCount }));
      }
      onClose();
    } catch {
      message.error(t('topic.housekeeping.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const noMatches = !previewLoading && !previewFailed && preview?.deletableTopicCount === 0;

  return (
    <Modal
      cancelText={t('cancel', { ns: 'common' })}
      centered
      closable={!submitting}
      confirmLoading={submitting}
      destroyOnClose
      maskClosable={!submitting}
      okButtonProps={{ danger: true, disabled: previewLoading || previewFailed || noMatches }}
      okText={
        mode === 'all'
          ? t('topic.housekeeping.allConfirm')
          : t('topic.housekeeping.olderThanConfirm')
      }
      onCancel={onClose}
      onOk={handleSubmit}
      open={open}
      title={t('topic.housekeeping.title')}
    >
      <Flexbox gap={16} paddingBlock={8}>
        <Segmented
          block
          onChange={(value) => setMode(value as 'olderThan' | 'all')}
          options={[
            { label: t('topic.housekeeping.olderThan'), value: 'olderThan' },
            { label: t('topic.housekeeping.all'), value: 'all' },
          ]}
          value={mode}
        />
        {mode === 'olderThan' && (
          <Flexbox align={'center'} gap={12} horizontal>
            <InputNumber
              aria-label={t('topic.housekeeping.olderThan')}
              max={3650}
              min={1}
              onChange={(value) => setDays(value ?? DEFAULT_DAYS)}
              precision={0}
              size={'large'}
              style={{ width: 140 }}
              value={days}
            />
            <Typography.Text>{t('topic.housekeeping.days')}</Typography.Text>
          </Flexbox>
        )}
        <Alert description={t('topic.housekeeping.notice')} showIcon type={'warning'} />
        <Flexbox gap={4} minHeight={44}>
          {previewLoading ? (
            <Spin size={'small'} />
          ) : previewFailed ? (
            <Typography.Text type={'danger'}>
              {t('topic.housekeeping.previewFailed')}
            </Typography.Text>
          ) : (
            <>
              {preview?.deletableTopicCount ? (
                <Typography.Text strong>
                  {t('topic.housekeeping.count', { count: preview.deletableTopicCount })}
                </Typography.Text>
              ) : (
                <Typography.Text type={'secondary'}>
                  {t('topic.housekeeping.noMatches')}
                </Typography.Text>
              )}
              {!!preview?.skippedActiveTopicCount && (
                <Typography.Text type={'secondary'}>
                  {t('topic.housekeeping.skipped', {
                    count: preview.skippedActiveTopicCount,
                  })}
                </Typography.Text>
              )}
            </>
          )}
        </Flexbox>
      </Flexbox>
    </Modal>
  );
});

HousekeepingDialog.displayName = 'HousekeepingDialog';

export default HousekeepingDialog;
