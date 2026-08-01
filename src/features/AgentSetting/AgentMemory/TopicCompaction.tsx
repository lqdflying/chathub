'use client';

import { Button, Input, Typography } from 'antd';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useSessionStore } from '@/store/session';

import { useStore } from '../store';

/**
 * Read-only view of the ACTIVE topic's rolling compaction summary. It reflects
 * chat state rather than the settings target, so it is only rendered when this
 * settings surface is showing the active session's agent.
 */
const TopicCompaction = memo(() => {
  const { t } = useTranslation('setting');

  const settingsTargetId = useStore((s) => s.id);
  const activeSessionId = useSessionStore((s) => s.activeId);
  const isActiveSessionTarget = !!settingsTargetId && settingsTargetId === activeSessionId;

  const topicContent = useChatStore(
    (s) => topicSelectors.currentActiveTopicSummary(s)?.content || '',
  );
  const title = useChatStore((s) => topicSelectors.currentActiveTopic(s)?.title || 'topic');

  const onCopy = useCallback(async () => {
    if (!topicContent) return;
    await navigator.clipboard.writeText(topicContent);
  }, [topicContent]);

  const onExport = useCallback(() => {
    if (!topicContent) return;
    const blob = new Blob([topicContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `topic-compaction-${String(title).replaceAll(/\W+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [topicContent, title]);

  if (!isActiveSessionTarget) return null;

  return (
    <Flexbox gap={8}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>
        {t('settingChatMemory.topicCompactionSection')}
      </div>
      <Typography.Text type={'secondary'}>
        {t('settingChatMemory.topicCompactionHint')}
      </Typography.Text>
      <Input.TextArea readOnly rows={10} value={topicContent} />
      <Flexbox gap={8} horizontal>
        <Button disabled={!topicContent} onClick={onCopy}>
          {t('settingChatMemory.copy')}
        </Button>
        <Button disabled={!topicContent} onClick={onExport}>
          {t('settingChatMemory.export')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

TopicCompaction.displayName = 'TopicCompaction';

export default TopicCompaction;
