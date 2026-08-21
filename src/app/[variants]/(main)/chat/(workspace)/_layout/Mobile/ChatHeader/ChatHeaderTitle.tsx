import { ActionIcon } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { createStyles, useTheme } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { useSessionStore } from '@/store/session';
import { sessionMetaSelectors, sessionSelectors } from '@/store/session/selectors';

const useStyles = createStyles(({ css }) => ({
  // Safari/iOS shows a centered black overlay for truncated text
  // (`text-overflow: ellipsis`). An empty block after the text disables it,
  // and pointer-events on the text lets the parent handle the topic-list tap.
  // https://zzz.buzz/2017/07/31/prevent-tooltip-over-truncated-text-in-safari
  // https://bugs.webkit.org/show_bug.cgi?id=114304
  truncatedText: css`
    pointer-events: none;

    overflow: hidden;
    display: block;

    text-overflow: ellipsis;
    white-space: nowrap;

    &::after {
      content: '';
      display: block;
    }
  `,
}));

const ChatHeaderTitle = memo(() => {
  const { t } = useTranslation(['chat', 'topic']);
  const { styles } = useStyles();
  const toggleConfig = useGlobalStore((s) => s.toggleMobileTopic);
  const [topicLength, topic] = useChatStore((s) => [
    topicSelectors.currentTopicLength(s),
    topicSelectors.currentActiveTopic(s),
  ]);
  const [isInbox, title] = useSessionStore((s) => [
    sessionSelectors.isInboxSession(s),
    sessionMetaSelectors.currentAgentTitle(s),
  ]);
  const theme = useTheme();

  const displayTitle = isInbox ? t('inbox.title') : title;
  const topicTitle = topic?.title || t('title', { ns: 'topic' });

  return (
    <ChatHeader.Title
      desc={
        <Flexbox align={'center'} gap={4} horizontal onClick={() => toggleConfig()}>
          <span className={styles.truncatedText} style={{ maxWidth: '60vw' }}>
            {topicTitle}
          </span>
          <ActionIcon
            active
            aria-label={t('title', { ns: 'topic' })}
            icon={ChevronDown}
            onClick={(event) => {
              event.stopPropagation();
              toggleConfig();
            }}
            size={{ blockSize: 14, borderRadius: '50%', size: 12 }}
            style={{
              background: theme.colorFillSecondary,
              color: theme.colorTextDescription,
            }}
          />
        </Flexbox>
      }
      title={
        <div onClick={() => toggleConfig()} style={{ marginRight: '8px', maxWidth: '64vw' }}>
          <span className={styles.truncatedText}>
            {displayTitle}
            {topicLength > 1 ? `(${topicLength + 1})` : ''}
          </span>
        </div>
      }
    />
  );
});

export default ChatHeaderTitle;
