'use client';

import { ActionIcon } from '@lobehub/ui';
import { App, Button, InputNumber, Modal, Popover, Segmented, Spin, Typography } from 'antd';
import { CircleHelp } from 'lucide-react';
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
const MIN_DAYS = 1;
const MAX_DAYS = 3650;

type AgeSelection = 1 | 7 | 30 | 'custom';

const HousekeepingDialog = memo<HousekeepingDialogProps>(({ onClose, open }) => {
  const { t } = useTranslation('image');
  const { message } = App.useApp();
  const [mode, setMode] = useState<'olderThan' | 'all'>('olderThan');
  const [ageSelection, setAgeSelection] = useState<AgeSelection>(DEFAULT_DAYS);
  const [customDays, setCustomDays] = useState<number | null>(DEFAULT_DAYS);
  const [preview, setPreview] = useState<ImageHistoryHousekeepingPreview>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const previewRequestRef = useRef(0);
  const previewHousekeeping = useImageStore((s) => s.previewGenerationTopicHousekeeping);
  const housekeep = useImageStore((s) => s.housekeepGenerationTopics);

  const customDaysValid =
    customDays !== null &&
    Number.isInteger(customDays) &&
    customDays >= MIN_DAYS &&
    customDays <= MAX_DAYS;
  const selectedDays = ageSelection === 'custom' ? customDays : ageSelection;
  const input = useMemo<ImageHistoryHousekeepingInput | undefined>(
    () =>
      mode === 'all'
        ? { mode: 'all' }
        : selectedDays !== null &&
            Number.isInteger(selectedDays) &&
            selectedDays >= MIN_DAYS &&
            selectedDays <= MAX_DAYS
          ? { days: selectedDays, mode: 'olderThan' }
          : undefined,
    [mode, selectedDays],
  );

  useEffect(() => {
    if (!open || !input) {
      previewRequestRef.current += 1;
      setPreview(undefined);
      setPreviewLoading(false);
      setPreviewFailed(false);
      return;
    }

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
    setAgeSelection(DEFAULT_DAYS);
    setCustomDays(DEFAULT_DAYS);
    setPreview(undefined);
    setPreviewFailed(false);
  }, [open]);

  const handleSubmit = async () => {
    if (!input) return;

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
  const submitDisabled = !input || !preview || previewLoading || previewFailed || noMatches;

  return (
    <Modal
      centered
      closable={!submitting}
      destroyOnClose
      footer={
        <Flexbox gap={8} horizontal width={'100%'}>
          <Button
            disabled={submitting}
            onClick={onClose}
            size={'large'}
            style={{ flex: 1, minHeight: 44 }}
          >
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button
            danger
            disabled={submitDisabled}
            loading={submitting}
            onClick={handleSubmit}
            size={'large'}
            style={{ flex: 1, minHeight: 44 }}
            type={'primary'}
          >
            {t('topic.housekeeping.confirm')}
          </Button>
        </Flexbox>
      }
      keyboard={!submitting}
      maskClosable={!submitting}
      onCancel={onClose}
      open={open}
      title={
        <Flexbox align={'center'} gap={6} horizontal>
          <span>{t('topic.housekeeping.title')}</span>
          <Popover
            content={t('topic.housekeeping.notice')}
            styles={{ body: { maxWidth: 320 } }}
            title={t('topic.housekeeping.help')}
            trigger={['hover', 'click']}
          >
            <ActionIcon
              aria-label={t('topic.housekeeping.help')}
              icon={CircleHelp}
              size={'small'}
              title={t('topic.housekeeping.help')}
            />
          </Popover>
        </Flexbox>
      }
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
          <Flexbox gap={12}>
            <Segmented
              block
              onChange={(value) => setAgeSelection(value as AgeSelection)}
              options={[
                { label: t('topic.housekeeping.oneDay'), value: 1 },
                { label: t('topic.housekeeping.sevenDays'), value: 7 },
                { label: t('topic.housekeeping.thirtyDays'), value: 30 },
                { label: t('topic.housekeeping.custom'), value: 'custom' },
              ]}
              value={ageSelection}
            />
            {ageSelection === 'custom' && (
              <Flexbox gap={6}>
                <Flexbox align={'center'} gap={12} horizontal>
                  <InputNumber
                    aria-describedby={
                      customDaysValid ? undefined : 'housekeeping-custom-days-error'
                    }
                    aria-invalid={!customDaysValid}
                    aria-label={t('topic.housekeeping.customDays')}
                    max={MAX_DAYS}
                    min={MIN_DAYS}
                    onChange={setCustomDays}
                    precision={0}
                    size={'large'}
                    status={customDaysValid ? undefined : 'error'}
                    style={{ flex: 1, width: '100%' }}
                    value={customDays}
                  />
                  <Typography.Text>{t('topic.housekeeping.days')}</Typography.Text>
                </Flexbox>
                {!customDaysValid && (
                  <Typography.Text
                    id={'housekeeping-custom-days-error'}
                    role={'alert'}
                    type={'danger'}
                  >
                    {t('topic.housekeeping.customDaysInvalid')}
                  </Typography.Text>
                )}
              </Flexbox>
            )}
          </Flexbox>
        )}
        <Flexbox aria-live={'polite'} gap={4} minHeight={44}>
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
