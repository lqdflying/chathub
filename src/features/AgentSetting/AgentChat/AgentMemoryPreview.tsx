'use client';

import { Button, Input, Typography } from 'antd';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const AgentMemoryPreview = memo(() => {
  const { t } = useTranslation('setting');
  const content = useChatStore((s) => topicSelectors.currentActiveTopicSummary(s)?.content || '');
  const title = useChatStore((s) => topicSelectors.currentActiveTopic(s)?.title || 'topic');

  const onCopy = useCallback(async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
  }, [content]);

  const onExport = useCallback(() => {
    if (!content) return;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memory-${String(title).replace(/\W+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [content, title]);

  return (
    <Flexbox gap={8}>
      <Typography.Text type={'secondary'}>{t('settingChatMemory.previewHint')}</Typography.Text>
      <Input.TextArea readOnly rows={10} value={content} />
      <Flexbox gap={8} horizontal>
        <Button disabled={!content} onClick={onCopy}>
          {t('settingChatMemory.copy')}
        </Button>
        <Button disabled={!content} onClick={onExport}>
          {t('settingChatMemory.export')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

AgentMemoryPreview.displayName = 'AgentMemoryPreview';

export default AgentMemoryPreview;
