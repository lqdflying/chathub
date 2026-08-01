'use client';

import { ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS } from '@lobechat/prompts';
import { App, Button, Input, Tooltip, Typography } from 'antd';
import { type ReactNode, memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { isDeprecatedEdition } from '@/const/version';
import Tokens from '@/features/AgentSetting/AgentPrompt/TokenTag';
import { normalizeAssistantMemoryText } from '@/helpers/assistantMemory';
import { useAgentStore } from '@/store/agent/store';
import { useSessionStore } from '@/store/session';

import { useStore } from '../store';

const formatTime = (iso: string | undefined) => {
  if (!iso) return undefined;
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? undefined : time.toLocaleString();
};

const errorReason = (error: unknown) =>
  (error as Error)?.message || String(error ?? 'unknown error');

/**
 * Auto-summarized dynamic memory: the rollup rewrites it incrementally; the
 * user can still inspect, edit, clear, regenerate, and restore the previous
 * version. Reads/writes go through the scoped AgentSetting store so every
 * surface (workspace drawer, defaults page, group member) targets the agent
 * it is actually showing.
 *
 * Every action reports success or failure via toast, and UI state is applied
 * optimistically instead of waiting on the write promise — a config write can
 * be aborted after the server committed it, so the promise alone is not a
 * reliable signal of what happened.
 */
const DynamicMemory = memo(() => {
  const { t } = useTranslation('setting');
  const { message, modal } = App.useApp();

  const [assistantMemory, assistantMemoryMeta, updateConfig] = useStore((s) => [
    s.config.assistantMemory ?? '',
    s.config.assistantMemoryMeta,
    s.setAgentConfig,
  ]);
  // rollup/restore operate on the ACTIVE session's agent, so they are only offered
  // when this settings surface is showing that agent
  const settingsTargetId = useStore((s) => s.id);
  const activeSessionId = useSessionStore((s) => s.activeId);
  const isActiveSessionTarget = !!settingsTargetId && settingsTargetId === activeSessionId;

  const rollupAssistantMemory = useAgentStore((s) => s.rollupAssistantMemory);
  const restoreAssistantMemoryBackup = useAgentStore((s) => s.restoreAssistantMemoryBackup);

  const [draft, setDraft] = useState(assistantMemory);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rollingUp, setRollingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    // background rollups refresh the doc; only sync when the user is not mid-edit
    if (!dirty) setDraft(assistantMemory);
  }, [assistantMemory, dirty]);

  // after a failed write the client cannot tell whether the server committed
  // (an abort can land post-commit) — refetch so the UI converges on DB truth
  const reconcileAfterError = useCallback(() => {
    if (!isActiveSessionTarget || !activeSessionId) return;
    void useAgentStore.getState().internal_refreshAgentConfig(activeSessionId);
  }, [isActiveSessionTarget, activeSessionId]);

  const onSave = useCallback(async () => {
    setSaving(true);
    const next = normalizeAssistantMemoryText(draft);
    setDraft(next);
    setDirty(false);
    try {
      await updateConfig({ assistantMemory: next });
      message.success(t('settingChatMemory.saveSuccess'));
    } catch (error) {
      message.error(t('settingChatMemory.saveFailedWithReason', { reason: errorReason(error) }));
      reconcileAfterError();
    } finally {
      setSaving(false);
    }
  }, [draft, updateConfig, message, t, reconcileAfterError]);

  const onClear = useCallback(() => {
    modal.confirm({
      content: t('settingChatMemory.clearConfirm'),
      okButtonProps: { danger: true },
      okText: t('settingChatMemory.clear'),
      // returns void so the modal closes immediately; the write continues with
      // its own loading state and reports via toast
      onOk: () => {
        setDraft('');
        setDirty(false);
        setSaving(true);
        void (async () => {
          try {
            await updateConfig({ assistantMemory: '' });
            message.success(t('settingChatMemory.clearSuccess'));
          } catch (error) {
            message.error(
              t('settingChatMemory.saveFailedWithReason', { reason: errorReason(error) }),
            );
            reconcileAfterError();
          } finally {
            setSaving(false);
          }
        })();
      },
      title: t('settingChatMemory.clear'),
    });
  }, [modal, message, t, updateConfig, reconcileAfterError]);

  const onCopy = useCallback(async () => {
    if (!assistantMemory) return;
    await navigator.clipboard.writeText(assistantMemory);
    message.success(t('settingChatMemory.copySuccess'));
  }, [assistantMemory, message, t]);

  const onRollup = useCallback(() => {
    modal.confirm({
      content: t('settingChatMemory.rollupConfirmDesc'),
      okText: t('settingChatMemory.rollupConfirmOk'),
      onOk: () => {
        setRollingUp(true);
        void (async () => {
          try {
            const result = await rollupAssistantMemory({ force: true, trigger: 'manual' });
            if (result.status === 'success') {
              setDirty(false);
              if (result.horizonTruncated) {
                message.info(
                  t('settingChatMemory.rollupHorizonHint', {
                    count: ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS,
                  }),
                );
              }
              message.success(t('settingChatMemory.rollupSuccess'));
            } else if (result.status === 'skipped') {
              message.warning(
                result.reason === 'no_changes'
                  ? t('settingChatMemory.rollupNoChanges')
                  : t('settingChatMemory.rollupSkipped'),
              );
            } else {
              message.error(
                result.reason
                  ? t('settingChatMemory.rollupFailedWithReason', { reason: result.reason })
                  : t('settingChatMemory.rollupFailed'),
              );
            }
          } catch (error) {
            message.error(
              t('settingChatMemory.rollupFailedWithReason', { reason: errorReason(error) }),
            );
          } finally {
            setRollingUp(false);
          }
        })();
      },
      title: t('settingChatMemory.rollupConfirmTitle'),
    });
  }, [modal, message, rollupAssistantMemory, t]);

  const onRestore = useCallback(async () => {
    setRestoring(true);
    try {
      const restored = await restoreAssistantMemoryBackup();
      if (restored) {
        setDirty(false);
        message.success(t('settingChatMemory.restoreSuccess'));
      } else {
        message.warning(t('settingChatMemory.restoreUnavailable'));
      }
    } catch (error) {
      message.error(t('settingChatMemory.saveFailedWithReason', { reason: errorReason(error) }));
      reconcileAfterError();
    } finally {
      setRestoring(false);
    }
  }, [restoreAssistantMemoryBackup, message, t, reconcileAfterError]);

  const lastRollupAt = formatTime(assistantMemoryMeta?.lastRollupAt);
  const hasBackup = !!assistantMemoryMeta?.previousMemory?.text;
  const notActiveTooltip = isActiveSessionTarget
    ? undefined
    : t('settingChatMemory.notActiveAgentTooltip');

  const withGate = (node: ReactNode) =>
    notActiveTooltip ? <Tooltip title={notActiveTooltip}>{node}</Tooltip> : node;

  return (
    <Flexbox gap={8}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>
        {t('settingChatMemory.dynamicMemory.title')}
      </div>
      <Typography.Text type={'secondary'}>
        {t('settingChatMemory.dynamicMemory.hint')}
      </Typography.Text>
      <Input.TextArea
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
        }}
        placeholder={t('settingChatMemory.dynamicMemory.empty')}
        rows={8}
        value={draft}
      />
      <Flexbox align={'center'} gap={12} horizontal style={{ flexWrap: 'wrap' }}>
        {!!assistantMemory && <Tokens value={assistantMemory} />}
        {lastRollupAt && (
          <Typography.Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('settingChatMemory.dynamicMemory.lastUpdated', { time: lastRollupAt })}
          </Typography.Text>
        )}
      </Flexbox>
      <Flexbox gap={8} horizontal style={{ flexWrap: 'wrap' }}>
        <Button disabled={!dirty} loading={saving} onClick={onSave} type={'primary'}>
          {t('settingChatMemory.dynamicMemory.save')}
        </Button>
        {!isDeprecatedEdition &&
          withGate(
            <Button disabled={!isActiveSessionTarget} loading={rollingUp} onClick={onRollup}>
              {t('settingChatMemory.regenerate')}
            </Button>,
          )}
        {!isDeprecatedEdition &&
          withGate(
            <Button
              disabled={!isActiveSessionTarget || !hasBackup}
              loading={restoring}
              onClick={onRestore}
            >
              {t('settingChatMemory.restorePrevious')}
            </Button>,
          )}
        <Button disabled={!assistantMemory} onClick={onCopy}>
          {t('settingChatMemory.copy')}
        </Button>
        <Button danger disabled={!assistantMemory && !draft} loading={saving} onClick={onClear}>
          {t('settingChatMemory.clear')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

DynamicMemory.displayName = 'DynamicMemory';

export default DynamicMemory;
