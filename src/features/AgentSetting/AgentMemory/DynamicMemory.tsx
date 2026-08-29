'use client';

import { ActionIcon } from '@lobehub/ui';
import { App, Button, Input, Popconfirm, Tag, Typography } from 'antd';
import { createStyles } from 'antd-style';
import { PencilIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import Tokens from '@/features/AgentSetting/AgentPrompt/TokenTag';
import {
  type DreamMemoryEntry,
  normalizeDreamMemoryDocument,
  parseDreamMemoryEntries,
} from '@/helpers/assistantMemory';
import { agentService } from '@/services/agent';

import { useStore } from '../store';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding: 12px 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  content: css`
    flex: 1;
    min-width: 0;

    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  hint: css`
    font-size: 12px;
    color: ${token.colorTextDescription};
  `,
  index: css`
    padding-top: 2px;
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    color: ${token.colorTextQuaternary};
  `,
}));

const matchSnippet = (body: string) => body.trim().slice(0, 80);

const errorReason = (error: unknown) =>
  (error as Error)?.message || String(error ?? 'unknown error');

const formatDateTag = (tag: string) => {
  if (tag === 'legacy') return 'legacy';
  if (tag.includes('..')) return tag.replace('..', ' – ');
  return tag;
};

/**
 * Dated dream-memory cards: one card per successful dream run (or merged range).
 * Edit/delete per card; regenerate re-runs the dream for that UTC history day only.
 */
const DynamicMemory = memo(() => {
  const { t } = useTranslation('setting');
  const { message, modal } = App.useApp();
  const { styles } = useStyles();

  const [assistantMemory, agentId, onRefreshConfig] = useStore((s) => [
    s.config.assistantMemory ?? '',
    s.config.id,
    s.onRefreshConfig,
  ]);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  const doc = useMemo(() => normalizeDreamMemoryDocument(assistantMemory), [assistantMemory]);
  const entries = useMemo(() => parseDreamMemoryEntries(doc), [doc]);

  const reconcileAfterError = useCallback(async () => {
    if (!onRefreshConfig) {
      message.error(
        t('settingChatMemory.reconcileFailedRetry', { reason: 'refresh unavailable' }),
      );
      return;
    }
    try {
      await onRefreshConfig();
    } catch (error) {
      message.error(
        t('settingChatMemory.reconcileFailedRetry', { reason: errorReason(error) }),
      );
    }
  }, [message, onRefreshConfig, t]);

  const handleMutationResult = useCallback(
    async (result: { reason?: string; status: string }) => {
      if (result.status === 'success') {
        await onRefreshConfig?.();
        message.success(t('settingChatMemory.saveSuccess'));
        return;
      }
      if (result.status === 'stale_conflict') {
        message.warning(t('settingChatMemory.regenerateStaleConflict'));
        await reconcileAfterError();
        return;
      }
      message.error(
        t('settingChatMemory.saveFailedWithReason', {
          reason: result.reason ?? 'unknown',
        }),
      );
      await reconcileAfterError();
    },
    [message, onRefreshConfig, reconcileAfterError, t],
  );

  const onDeleteEntry = async (entry: DreamMemoryEntry) => {
    if (!agentId) return;
    try {
      const result = await agentService.deleteDreamMemoryCard({
        agentId,
        dateTag: entry.dateTag,
        index: entry.index,
        match: matchSnippet(entry.body),
      });
      await handleMutationResult(result);
    } catch (error) {
      message.error(
        t('settingChatMemory.saveFailedWithReason', { reason: errorReason(error) }),
      );
      await reconcileAfterError();
    }
  };

  const onSaveEntry = async (entry: DreamMemoryEntry) => {
    const next = editDraft.trim();
    setEditingIndex(null);
    if (!next || next === entry.body || !agentId) return;

    try {
      const result = await agentService.updateDreamMemoryCard({
        agentId,
        body: next,
        dateTag: entry.dateTag,
        index: entry.index,
        match: matchSnippet(entry.body),
      });
      await handleMutationResult(result);
    } catch (error) {
      message.error(
        t('settingChatMemory.saveFailedWithReason', { reason: errorReason(error) }),
      );
      await reconcileAfterError();
    }
  };

  const onRegenerate = async (entry: DreamMemoryEntry) => {
    if (!agentId || !entry.regenerable) return;

    setRegeneratingIndex(entry.index);
    try {
      const result = await agentService.regenerateDreamMemory({
        agentId,
        historyDate: entry.dateTag,
        index: entry.index,
        match: matchSnippet(entry.body),
      });

      switch (result.status) {
        case 'success': {
          message.success(t('settingChatMemory.rollupSuccess'));
          await onRefreshConfig?.();
          break;
        }
        case 'skipped': {
          switch (result.reason) {
            case 'no_changes': {
              message.info(t('settingChatMemory.rollupNoChanges'));
              break;
            }
            case 'no_summaries': {
              message.warning(t('settingChatMemory.rollupSkipped'));
              break;
            }
            case 'stale_conflict': {
              message.warning(t('settingChatMemory.regenerateStaleConflict'));
              await reconcileAfterError();
              break;
            }
            default: {
              break;
            }
          }
          break;
        }
        default: {
          message.error(
            t('settingChatMemory.rollupFailedWithReason', {
              reason: result.reason ?? 'unknown',
            }),
          );
        }
      }
    } catch (error) {
      message.error(
        t('settingChatMemory.rollupFailedWithReason', {
          reason: errorReason(error),
        }),
      );
    } finally {
      setRegeneratingIndex(null);
    }
  };

  const onClear = () => {
    modal.confirm({
      content: t('settingChatMemory.clearConfirm'),
      okButtonProps: { danger: true },
      okText: t('settingChatMemory.clear'),
      onOk: () => {
        if (!agentId) return;
        setClearing(true);
        void (async () => {
          try {
            const result = await agentService.clearDreamMemory({ agentId });
            if (result.status === 'success') {
              await onRefreshConfig?.();
              message.success(t('settingChatMemory.clearSuccess'));
            } else {
              await handleMutationResult(result);
            }
          } catch (error) {
            message.error(
              t('settingChatMemory.saveFailedWithReason', { reason: errorReason(error) }),
            );
            await reconcileAfterError();
          } finally {
            setClearing(false);
          }
        })();
      },
      title: t('settingChatMemory.clear'),
    });
  };

  const onCopy = async () => {
    if (!doc) return;
    await navigator.clipboard.writeText(doc);
    message.success(t('settingChatMemory.copySuccess'));
  };

  return (
    <Flexbox gap={8}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>
        {t('settingChatMemory.dynamicMemory.title')}
      </div>
      <Typography.Text type={'secondary'}>
        {t('settingChatMemory.dynamicMemory.hint')}
      </Typography.Text>

      <Flexbox gap={8}>
        {entries.map((entry) => (
          <Flexbox className={styles.card} gap={8} key={`${entry.index}-${entry.dateTag}`}>
            {editingIndex === entry.index ? (
              <>
                <Input.TextArea
                  autoFocus
                  autoSize={{ maxRows: 8, minRows: 2 }}
                  onChange={(e) => setEditDraft(e.target.value)}
                  value={editDraft}
                />
                <Flexbox gap={8} horizontal justify={'flex-end'}>
                  <Button onClick={() => setEditingIndex(null)} size={'small'}>
                    {t('cancel', { ns: 'common' })}
                  </Button>
                  <Button onClick={() => void onSaveEntry(entry)} size={'small'} type={'primary'}>
                    {t('ok', { ns: 'common' })}
                  </Button>
                </Flexbox>
              </>
            ) : (
              <Flexbox align={'flex-start'} gap={12} horizontal>
                <span className={styles.index}>#{entry.index}</span>
                <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
                  <Tag style={{ width: 'fit-content' }}>{formatDateTag(entry.dateTag)}</Tag>
                  <div className={styles.content}>{entry.body}</div>
                </Flexbox>
                <Flexbox gap={2} horizontal>
                  {entry.regenerable && (
                    <ActionIcon
                      icon={RefreshCwIcon}
                      loading={regeneratingIndex === entry.index}
                      onClick={() => void onRegenerate(entry)}
                      size={'small'}
                      title={t('settingChatMemory.regenerate')}
                    />
                  )}
                  <ActionIcon
                    icon={PencilIcon}
                    onClick={() => {
                      setEditDraft(entry.body);
                      setEditingIndex(entry.index);
                    }}
                    size={'small'}
                    title={t('edit', { ns: 'common' })}
                  />
                  <Popconfirm
                    cancelText={t('cancel', { ns: 'common' })}
                    okText={t('ok', { ns: 'common' })}
                    onConfirm={() => void onDeleteEntry(entry)}
                    title={t('settingChatMemory.dynamicMemory.deleteConfirm')}
                  >
                    <ActionIcon
                      icon={Trash2Icon}
                      size={'small'}
                      title={t('delete', { ns: 'common' })}
                    />
                  </Popconfirm>
                </Flexbox>
              </Flexbox>
            )}
          </Flexbox>
        ))}
        {entries.length === 0 && (
          <div className={styles.hint}>{t('settingChatMemory.dynamicMemory.empty')}</div>
        )}
      </Flexbox>

      <Flexbox align={'center'} gap={12} horizontal style={{ flexWrap: 'wrap' }}>
        {!!doc && <Tokens value={doc} />}
      </Flexbox>
      <Flexbox gap={8} horizontal style={{ flexWrap: 'wrap' }}>
        <Button disabled={!doc} onClick={() => void onCopy()}>
          {t('settingChatMemory.copy')}
        </Button>
        <Button danger disabled={!doc} loading={clearing} onClick={onClear}>
          {t('settingChatMemory.clear')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

DynamicMemory.displayName = 'DynamicMemory';

export default DynamicMemory;
