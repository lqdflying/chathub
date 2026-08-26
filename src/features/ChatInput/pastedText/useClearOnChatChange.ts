import { useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

import { usePastedTextStore } from './store';

export const useClearPastedTextsOnChatChange = () => {
  const chatKey = useChatStore(chatSelectors.currentChatKey);
  const previousChatKey = useRef(chatKey);

  useEffect(() => {
    if (previousChatKey.current === chatKey) return;
    previousChatKey.current = chatKey;
    usePastedTextStore.getState().clearPastedTexts();
  }, [chatKey]);
};
