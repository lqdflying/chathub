'use client';

import { ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS } from '@lobechat/prompts';
import { Button, Input, Modal, Tooltip, Typography, message } from 'antd';
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

/**
 * Auto-summarized dynamic memory: the rollup rewrites it incrementally; the
 * user can still inspect, edit, clear, regenerate, and restore the previous
 * version. Reads/writes go through the scoped AgentSetting store so every
 * surface (workspace drawer, defaults page, group member) targets the agent
 * it is actually showing.
 */
const DynamicMemory = memo(() => {
  const { t } = useTranslation('setting');

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

  const onSave = useCallback(async () => {
    setSaving(true);
    try {
      const next = normalizeAssistantMemoryText(draft);
      await updateConfig({ assistantMemory: next });
      setDraft(next);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [draft, updateConfig]);

  const onClear = useCallback(() => {
    Modal.confirm({
      content: t('settingChatMemory.clearConfirm'),
      okButtonProps: { danger: true },
      okText: t('settingChatMemory.clear'),
      onOk: async () => {
        await updateConfig({ assistantMemory: '' });
        setDraft('');
        setDirty(false);
      },
      title: t('settingChatMemory.clear'),
    });
  }, [t, updateConfig]);

  const onCopy = useCallback(async () => {
    if (!assistantMemory) return;
    await navigator.clipboard.writeText(assistantMemory);
    message.success(t('settingChatMemory.copySuccess'));
  }, [assistantMemory, t]);

  const onRollup = useCallback(() => {
    Modal.confirm({
      content: t('settingChatMemory.rollupConfirmDesc'),
      okText: t('settingChatMemory.rollupConfirmOk'),
      onOk: async () => {
        setRollingUp(true);
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
        } finally {
          setRollingUp(false);
        }
      },
      title: t('settingChatMemory.rollupConfirmTitle'),
    });
  }, [rollupAssistantMemory, t]);

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
    } finally {
      setRestoring(false);
    }
  }, [restoreAssistantMemoryBackup, t]);

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
        <Button danger disabled={!assistantMemory && !draft} onClick={onClear}>
          {t('settingChatMemory.clear')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

DynamicMemory.displayName = 'DynamicMemory';

export default DynamicMemory;
