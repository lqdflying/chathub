'use client';

import isEqual from 'fast-deep-equal';
import React, { memo, useCallback } from 'react';

import { SkeletonList, VirtualizedList } from '@/features/Conversation';
import WideScreenContainer from '@/features/Conversation/components/WideScreenContainer';
import { useFetchMessages } from '@/hooks/useFetchMessages';
import { useConversationGenerationSync } from '@/hooks/useConversationGenerationSync';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

import MainChatItem from './ChatItem';
import Welcome from './WelcomeChatItem';

interface ListProps {
  mobile?: boolean;
}

const Content = memo<ListProps>(({ mobile }) => {
  const isCurrentChatLoaded = useChatStore(chatSelectors.isCurrentChatLoaded);

  useFetchMessages();
  useConversationGenerationSync();
  const data = useChatStore(chatSelectors.mainDisplayChatIDs, isEqual);

  const itemContent = useCallback(
    (index: number, id: string, context?: { isScrolling?: boolean }) => (
      <MainChatItem
        historyLength={data.length}
        id={id}
        index={index}
        isScrolling={context?.isScrolling}
      />
    ),
    [data.length, mobile],
  );

  if (!isCurrentChatLoaded) return <SkeletonList mobile={mobile} />;

  if (data.length === 0)
    return (
      <WideScreenContainer flex={1} height={'100%'}>
        <Welcome />
      </WideScreenContainer>
    );

  return <VirtualizedList dataSource={data} itemContent={itemContent} mobile={mobile} />;
});

Content.displayName = 'ChatListRender';

export default Content;
