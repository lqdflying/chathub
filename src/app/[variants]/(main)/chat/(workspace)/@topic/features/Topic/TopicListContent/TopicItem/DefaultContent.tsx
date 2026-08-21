import { Icon, Tag, Text } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { LucideLoader2, MessageSquareDashed } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { reportTopicBusyChanged } from '@/libs/logger/generationDebugClient';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const DefaultContent = memo(() => {
  const { t } = useTranslation('topic');
  const theme = useTheme();
  const isLoading = useChatStore(topicSelectors.isTopicLoading());

  useEffect(() => {
    try {
      const state = useChatStore.getState?.();
      const flags = state
        ? topicSelectors.topicBusyFlags()(state)
        : {
            deferredLane: false,
            durableJob: false,
            producing: isLoading,
            sendRpc: false,
            tools: false,
            topicCrud: false,
          };
      reportTopicBusyChanged(null, isLoading, flags);
    } catch {
      // Diagnostics must never break the topic list.
    }
  }, [isLoading]);

  return (
    <Flexbox align={'center'} gap={8} horizontal>
      <Flexbox
        align={'center'}
        aria-busy={isLoading}
        aria-label={isLoading ? t('generating') : undefined}
        height={24}
        justify={'center'}
        width={24}
      >
        <Icon
          color={theme.colorTextDescription}
          icon={isLoading ? LucideLoader2 : MessageSquareDashed}
          spin={isLoading}
          title={isLoading ? t('generating') : undefined}
        />
      </Flexbox>
      <Text ellipsis={{ rows: 1 }} style={{ margin: 0 }}>
        {t('defaultTitle')}
      </Text>
      <Tag>{t('temp')}</Tag>
    </Flexbox>
  );
});

export default DefaultContent;
