'use client';

import { Button, Input, Modal, Typography, message } from 'antd';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { agentSelectors } from '@/store/agent/selectors';
import { useAgentStore } from '@/store/agent/store';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const AgentMemoryPreview = memo(() => {
  const { t } = useTranslation('setting');
  const assistantMemory = useAgentStore(
    (s) => agentSelectors.currentAgentConfig(s).assistantMemory ?? '',
  );
  const activeId = useAgentStore((s) => s.activeId);
  const updateAgentConfig = useAgentStore((s) => s.updateAgentConfig);
  const rollupAssistantMemory = useAgentStore((s) => s.rollupAssistantMemory);

  const [draftMemory, setDraftMemory] = useState(assistantMemory);
  const [saving, setSaving] = useState(false);
  const [rollingUp, setRollingUp] = useState(false);

  useEffect(() => {
    setDraftMemory(assistantMemory ?? '');
  }, [assistantMemory, activeId]);

  const onSaveAssistantMemory = useCallback(async () => {
    setSaving(true);
    try {
      await updateAgentConfig({ assistantMemory: draftMemory });
    } finally {
      setSaving(false);
    }
  }, [draftMemory, updateAgentConfig]);

  const topicContent = useChatStore(
    (s) => topicSelectors.currentActiveTopicSummary(s)?.content || '',
  );
  const title = useChatStore((s) => topicSelectors.currentActiveTopic(s)?.title || 'topic');

  const onCopyTopic = useCallback(async () => {
    if (!topicContent) return;
    await navigator.clipboard.writeText(topicContent);
  }, [topicContent]);

  const onExportTopic = useCallback(() => {
    if (!topicContent) return;
    const blob = new Blob([topicContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `topic-compaction-${String(title).replace(/\W+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [topicContent, title]);

  const onRollupAssistantMemory = useCallback(() => {
    Modal.confirm({
      content: t('settingChatMemory.rollupConfirmDesc'),
      okText: t('settingChatMemory.rollupConfirmOk'),
      onOk: async () => {
        setRollingUp(true);
        try {
          const r = await rollupAssistantMemory();
          if (r.skipped) {
            message.warning(t('settingChatMemory.rollupSkipped'));
          } else if (r.success) {
            message.success(t('settingChatMemory.rollupSuccess'));
          } else {
            message.error(t('settingChatMemory.rollupFailed'));
          }
        } finally {
          setRollingUp(false);
        }
      },
      title: t('settingChatMemory.rollupConfirmTitle'),
    });
  }, [rollupAssistantMemory, t]);

  return (
    <Flexbox gap={20}>
      <Flexbox gap={8}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {t('settingChatMemory.assistantMemorySection')}
        </div>
        <Typography.Text type={'secondary'}>{t('settingChatMemory.assistantMemoryHint')}</Typography.Text>
        <Input.TextArea
          onChange={(e) => setDraftMemory(e.target.value)}
          rows={8}
          value={draftMemory}
        />
        <Flexbox gap={8} horizontal style={{ flexWrap: 'wrap' }}>
          <Button loading={saving} onClick={onSaveAssistantMemory} type={'primary'}>
            {t('settingChatMemory.saveAssistantMemory')}
          </Button>
          <Button loading={rollingUp} onClick={onRollupAssistantMemory}>
            {t('settingChatMemory.rollupAssistantMemory')}
          </Button>
        </Flexbox>
      </Flexbox>

      <Flexbox gap={8}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {t('settingChatMemory.topicCompactionSection')}
        </div>
        <Typography.Text type={'secondary'}>{t('settingChatMemory.topicCompactionHint')}</Typography.Text>
        <Input.TextArea readOnly rows={10} value={topicContent} />
        <Flexbox gap={8} horizontal>
          <Button disabled={!topicContent} onClick={onCopyTopic}>
            {t('settingChatMemory.copy')}
          </Button>
          <Button disabled={!topicContent} onClick={onExportTopic}>
            {t('settingChatMemory.export')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

AgentMemoryPreview.displayName = 'AgentMemoryPreview';

export default AgentMemoryPreview;
