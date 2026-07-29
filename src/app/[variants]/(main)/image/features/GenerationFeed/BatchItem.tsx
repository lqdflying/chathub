'use client';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import { ModelTag } from '@lobehub/icons';
import {
  ActionIconGroup,
  type ActionIconGroupProps,
  Block,
  Grid,
  Markdown,
  Tag,
  Text,
} from '@lobehub/ui';
import { App } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { omit } from 'lodash-es';
import { CopyIcon, RefreshCw, RotateCcwSquareIcon, Trash2 } from 'lucide-react';
import { RuntimeImageGenParams } from 'model-bank';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import InvalidAPIKey from '@/components/InvalidAPIKey';
import { useImageStore } from '@/store/image';
import { ImageRegenerationCleanupError } from '@/store/image/slices/createImage/action';
import { createImageSelectors } from '@/store/image/slices/createImage/selectors';
import { AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';
import { GenerationBatch } from '@/types/generation';

import { GenerationItem } from './GenerationItem';
import { DEFAULT_MAX_ITEM_WIDTH } from './GenerationItem/utils';
import { ReferenceImages } from './ReferenceImages';

const useStyles = createStyles(({ cx, css, token }) => ({
  batchActions: cx(
    'batch-actions',
    css`
      opacity: 1;
      transition: opacity 0.1s ${token.motionEaseInOut};

      @media (hover: hover) and (pointer: fine) {
        opacity: 0;
      }
    `,
  ),
  batchDeleteButton: css`
    &:hover {
      border-color: ${token.colorError} !important;
      color: ${token.colorError} !important;
      background: ${token.colorErrorBg} !important;
    }
  `,
  container: css`
    &:hover,
    &:focus-within {
      .batch-actions {
        opacity: 1;
      }
    }
  `,

  prompt: css`
    pre {
      overflow: hidden !important;
      padding-block: 4px;
      font-size: 13px;
    }
  `,
}));

// 扩展 dayjs 插件
dayjs.extend(relativeTime);

interface GenerationBatchItemProps {
  batch: GenerationBatch;
}

export const GenerationBatchItem = memo<GenerationBatchItemProps>(({ batch }) => {
  const { styles } = useStyles();
  const { t } = useTranslation(['image', 'modelProvider', 'error']);
  const { message } = App.useApp();

  const [imageGridRef] = useAutoAnimate();

  const activeTopicId = useImageStore((s) => s.activeGenerationTopicId);
  const removeGenerationBatch = useImageStore((s) => s.removeGenerationBatch);
  const recreateImage = useImageStore((s) => s.recreateImage);
  const reuseSettings = useImageStore((s) => s.reuseSettings);
  const isRegenerating = useImageStore(createImageSelectors.isBatchRegenerating(batch.id));

  const time = useMemo(() => {
    return dayjs(batch.createdAt).format('YYYY-MM-DD HH:mm:ss');
  }, [batch.createdAt]);

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(batch.prompt);
      message.success(t('generation.actions.promptCopied'));
    } catch (error) {
      console.error('Failed to copy prompt:', error);
      message.error(t('generation.actions.promptCopyFailed'));
    }
  };

  const handleReuseSettings = () => {
    reuseSettings(
      batch.model,
      batch.provider,
      omit(batch.config as RuntimeImageGenParams, ['seed']),
    );
  };

  const handleRegenerate = async () => {
    try {
      await recreateImage(batch.id);
    } catch (error) {
      console.error('Failed to regenerate image:', error);
      message.error(
        t(
          error instanceof ImageRegenerationCleanupError
            ? 'generation.actions.regenerateCleanupFailed'
            : 'generation.actions.generateFailed',
        ),
      );
    }
  };

  const handleDeleteBatch = async () => {
    if (!activeTopicId) return;

    try {
      await removeGenerationBatch(batch.id, activeTopicId);
    } catch (error) {
      console.error('Failed to delete batch:', error);
    }
  };

  if (batch.generations.length === 0) {
    return null;
  }

  const isInvalidApiKey = batch.generations.some(
    (generation) => generation.task.error?.name === AsyncTaskErrorType.InvalidProviderAPIKey,
  );
  const hasFailedGenerations = batch.generations.some(
    (generation) => generation.task.status === AsyncTaskStatus.Error,
  );

  if (isInvalidApiKey) {
    // Use unified InvalidAPIKey component for all providers (including ComfyUI)
    return (
      <InvalidAPIKey
        description={t('unlock.apiKey.imageGenerationDescription', {
          name: batch.provider,
          ns: 'error',
        })}
        id={batch.id}
        loading={isRegenerating}
        onClose={() => {
          removeGenerationBatch(batch.id, activeTopicId!);
        }}
        onRecreate={() => {
          void handleRegenerate();
        }}
        provider={batch.provider}
      />
    );
  }

  // Calculate total number of reference images
  const referenceImageCount =
    (batch.config?.imageUrl ? 1 : 0) + (batch.config?.imageUrls?.length || 0);

  const isSingleImageLayout = referenceImageCount === 1;

  // Content for prompt and metadata
  const promptAndMetadata = (
    <>
      <Markdown variant={'chat'}>{batch.prompt}</Markdown>
      <Flexbox gap={4} horizontal justify="space-between" style={{ marginBottom: 10 }}>
        <Flexbox gap={4} horizontal wrap="wrap">
          <ModelTag model={batch.model} />
          {batch.width && batch.height && (
            <Tag>
              {batch.width} × {batch.height}
            </Tag>
          )}
          <Tag>{t('generation.metadata.count', { count: batch.generations.length })}</Tag>
        </Flexbox>
      </Flexbox>
    </>
  );

  return (
    <Block className={styles.container} gap={8} variant="borderless">
      {isSingleImageLayout ? (
        // Single image layout: horizontal arrangement with vertical centering
        <Flexbox align="center" gap={16} horizontal wrap="wrap">
          <ReferenceImages
            imageUrl={batch.config?.imageUrl}
            imageUrls={batch.config?.imageUrls}
            layout="single"
          />
          <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
            {promptAndMetadata}
          </Flexbox>
        </Flexbox>
      ) : (
        // Multiple images or no images: vertical arrangement
        <>
          <ReferenceImages
            imageUrl={batch.config?.imageUrl}
            imageUrls={batch.config?.imageUrls}
            layout="multiple"
          />
          {promptAndMetadata}
        </>
      )}
      <Grid
        maxItemWidth={DEFAULT_MAX_ITEM_WIDTH}
        ref={imageGridRef}
        rows={batch.generations.length}
      >
        {batch.generations.map((generation) => (
          <GenerationItem
            generation={generation}
            generationBatch={batch}
            key={generation.id}
            prompt={batch.prompt}
          />
        ))}
      </Grid>
      <Flexbox
        align={'center'}
        className={styles.batchActions}
        horizontal
        justify={'space-between'}
      >
        <Text as={'time'} fontSize={12} type={'secondary'}>
          {time}
        </Text>
        <ActionIconGroup
          actionIconProps={{ size: { blockSize: 44, size: 20 } }}
          items={[
            hasFailedGenerations && {
              disabled: isRegenerating,
              icon: RefreshCw,
              key: 'regenerate',
              label: t(
                isRegenerating
                  ? 'generation.actions.regenerating'
                  : 'generation.actions.regenerate',
              ),
              loading: isRegenerating,
              onClick: handleRegenerate,
            },
            {
              icon: RotateCcwSquareIcon,
              key: 'reuseSettings',
              label: t('generation.actions.reuseSettings'),
              onClick: handleReuseSettings,
            },
            {
              icon: CopyIcon,
              key: 'copyPrompt',
              label: t('generation.actions.copyPrompt'),
              onClick: handleCopyPrompt,
            },
            {
              danger: true,
              icon: Trash2,
              key: 'deleteBatch',
              label: t('generation.actions.deleteBatch'),
              onClick: handleDeleteBatch,
            },
          ].filter(Boolean) as ActionIconGroupProps['items']}
        />
      </Flexbox>
    </Block>
  );
});

GenerationBatchItem.displayName = 'GenerationBatchItem';
