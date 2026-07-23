import dynamic from 'next/dynamic';
import { PropsWithChildren, memo } from 'react';

import { useModelHasContextWindowToken } from '@/hooks/useModelHasContextWindowToken';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

const LargeTokenContent = dynamic(() => import('./TokenTag'), { ssr: false });
const LargeTokenContentForGroupChat = dynamic(() => import('./TokenTagForGroupChat'), {
  ssr: false,
});

const Token = memo<PropsWithChildren>(({ children }) => {
  const showTag = useModelHasContextWindowToken();

  return showTag && children;
});

export const MainToken = memo(() => {
  return (
    <Token>
      <LargeTokenContent />
    </Token>
  );
});

export const PortalToken = memo(() => {
  return (
    <Token>
      <LargeTokenContent conversationSource={'portal'} />
    </Token>
  );
});

export const GroupChatToken = memo(() => {
  const total = useChatStore(chatSelectors.mainAIChatsMessageString);

  return (
    <Token>
      <LargeTokenContentForGroupChat total={total} />
    </Token>
  );
});
