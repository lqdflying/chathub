import { memo, useEffect } from 'react';

import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

import BackBottom from './BackBottom';

interface AutoScrollProps {
  atBottom: boolean;
  isScrolling: boolean;
  onScrollToBottom: (type: 'auto' | 'click') => void;
}
const AutoScroll = memo<AutoScrollProps>(({ atBottom, isScrolling, onScrollToBottom }) => {
  const trackVisibility = useChatStore(chatSelectors.isAIGenerating);
  const followOutputRevision = useChatStore(chatSelectors.mainAIFollowOutputRevision);

  useEffect(() => {
    if (atBottom && trackVisibility && !isScrolling) {
      onScrollToBottom?.('auto');
    }
  }, [atBottom, followOutputRevision, isScrolling, onScrollToBottom, trackVisibility]);

  return <BackBottom onScrollToBottom={() => onScrollToBottom('click')} visible={!atBottom} />;
});

export default AutoScroll;
