'use client';

import { ChatHeader } from '@lobehub/ui/chat';
import { useTheme } from 'antd-style';

import { CHAT_HEADER_HEIGHT } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import HeaderAction from './HeaderAction';
import Main from './Main';

const Header = () => {
  const showHeader = useGlobalStore(systemStatusSelectors.showChatHeader);
  const theme = useTheme();

  return (
    showHeader && (
      <ChatHeader
        left={<Main />}
        right={<HeaderAction />}
        style={{
          borderBlockEnd: `1px solid ${theme.colorBorderSecondary}`,
          height: CHAT_HEADER_HEIGHT,
          maxHeight: CHAT_HEADER_HEIGHT,
          minHeight: CHAT_HEADER_HEIGHT,
          paddingInline: 10,
          position: 'initial',
          zIndex: 11,
        }}
      />
    )
  );
};

export default Header;
