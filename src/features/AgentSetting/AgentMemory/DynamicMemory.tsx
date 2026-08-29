'use client';

import { App, Button, Input, Typography } from 'antd';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import Tokens from '@/features/AgentSetting/AgentPrompt/TokenTag';
import { normalizeAssistantMemoryText } from '@/helpers/assistantMemory';

import { useStore } from '../store';

const errorReason = (error: unknown) =>
  (error as Error)?.message || String(error ?? 'unknown error');

/**
 * Auto-summarized dynamic memory: the memory dream rewrites it incrementally;
 * the user can still inspect, edit, copy, clear, and save. Reads/writes go
 * through the scoped AgentSetting store so every surface (workspace drawer,
 * defaults page, group member) targets the agent it is actually showing.
 *
 * Every action reports success or failure via toast, and UI state is applied
 * optimistically instead of waiting on the write promise — a config write can
 * be aborted after the server committed it, so the promise alone is not a
 * reliable signal of what happened.
 */
const DynamicMemory = memo(() => {
  const { t } = useTranslation('setting');
  const { message, modal } = App.useApp();

  const [assistantMemory, updateConfig, onRefreshConfig] = useStore((s) => [
    s.config.assistantMemory ?? '',
    s.setAgentConfig,
    s.onRefreshConfig,
  ]);

  const [draft, setDraft] = useState(assistantMemory);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // background dream updates refresh the doc; only sync when not mid-edit
    if (!dirty) setDraft(assistantMemory);
  }, [assistantMemory, dirty]);

  // after a failed write the client cannot tell whether the server committed
  // (an abort can land post-commit) — refetch so the UI converges on DB truth
  const reconcileAfterError = useCallback(async () => {
    await onRefreshConfig?.();
  }, [onRefreshConfig]);

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
      await reconcileAfterError();
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
            await reconcileAfterError();
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
      </Flexbox>
      <Flexbox gap={8} horizontal style={{ flexWrap: 'wrap' }}>
        <Button disabled={!dirty} loading={saving} onClick={onSave} type={'primary'}>
          {t('settingChatMemory.dynamicMemory.save')}
        </Button>
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
