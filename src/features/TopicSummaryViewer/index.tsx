'use client';

import { exportFile } from '@lobechat/utils/client';
import { ModelTag } from '@lobehub/icons';
import { Markdown, copyToClipboard } from '@lobehub/ui';
import { App, Button, Drawer, Empty } from 'antd';
import { Copy, Download } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

interface TopicSummaryViewerProps {
  onClose: () => void;
  open: boolean;
  topicId: string;
}

/**
 * Read-only drawer showing a topic's rolling compaction summary with copy/export.
 * Session-level surface: opened from the token popover (active topic) and from
 * each topic's dropdown menu (any topic).
 */
const TopicSummaryViewer = memo<TopicSummaryViewerProps>(({ onClose, open, topicId }) => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();
  const isMobile = useIsMobile();

  const topic = useChatStore((s) => topicSelectors.getTopicById(topicId)(s));
  const content = topic?.historySummary || '';
  const model = topic?.metadata?.model;
  const title = topic?.title || 'topic';

  const handleCopy = async () => {
    if (!content) return;
    await copyToClipboard(content);
    message.success(t('memoryCompaction.viewer.copySuccess'));
  };

  const handleExport = () => {
    if (!content) return;
    exportFile(content, `topic-compaction-${String(title).replaceAll(/\W+/g, '-')}.md`);
  };

  return (
    <Drawer
      destroyOnHidden
      footer={
        <Flexbox gap={8} horizontal={!isMobile}>
          <Button
            block={isMobile}
            disabled={!content}
            icon={<Copy size={16} />}
            onClick={handleCopy}
          >
            {t('memoryCompaction.viewer.copy')}
          </Button>
          <Button
            block={isMobile}
            disabled={!content}
            icon={<Download size={16} />}
            onClick={handleExport}
            type={'primary'}
          >
            {t('memoryCompaction.viewer.export')}
          </Button>
        </Flexbox>
      }
      height={isMobile ? '92vh' : undefined}
      onClose={onClose}
      open={open}
      placement={isMobile ? 'bottom' : 'right'}
      title={t('memoryCompaction.viewer.title')}
      width={isMobile ? undefined : 640}
    >
      <Flexbox gap={12}>
        {model && (
          <Flexbox horizontal>
            <ModelTag model={model} />
          </Flexbox>
        )}
        {content ? (
          <Markdown variant={'chat'}>{content}</Markdown>
        ) : (
          <Empty description={t('memoryCompaction.viewer.empty')} />
        )}
      </Flexbox>
    </Drawer>
  );
});

TopicSummaryViewer.displayName = 'TopicSummaryViewer';

export default TopicSummaryViewer;
