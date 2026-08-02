'use client';

import { Skeleton } from 'antd';
import { useTheme } from 'antd-style';
import { TextAreaRef } from 'antd/es/input/TextArea';
import { memo, useRef, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { ActionKeys } from '@/features/ChatInput/ActionBar/config';
import { MOBILE_CHAT_LEFT_ACTIONS } from '@/features/ChatInput/ActionBar/presets';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { useChatStore } from '@/store/chat';
import { aiChatSelectors, chatSelectors } from '@/store/chat/selectors';

import ActionBar from './ActionBar';
import Files from './Files';
import InputArea from './InputArea';
import SendButton from './Send';
import { useSendMessage } from './useSend';

const defaultRightActions: ActionKeys[] = ['saveTopic', 'clear'];

const MobileChatInput = memo(() => {
  const theme = useTheme();
  const ref = useRef<TextAreaRef>(null);
  const [expand, setExpand] = useState<boolean>(false);
  const { send: sendMessage, canSend } = useSendMessage();
  const { isLoading } = useInitAgentConfig();

  const [loading, value, onInput, onStop] = useChatStore((s) => [
    // pre-send compaction is stoppable too, so surface it as loading
    chatSelectors.isAIGenerating(s) || aiChatSelectors.isCurrentPreSendCompacting(s),
    s.inputMessage,
    s.updateInputMessage,
    s.stopGenerateMessage,
  ]);

  return (
    <InputArea
      expand={expand}
      onInput={onInput}
      onSend={() => {
        setExpand(false);

        sendMessage();
      }}
      ref={ref}
      setExpand={setExpand}
      style={{
        background: theme.colorBgContainer,
        top: expand ? 0 : undefined,
        width: '100%',
        zIndex: 101,
      }}
      textAreaRightAddons={
        <SendButton disabled={!canSend} loading={loading} onSend={sendMessage} onStop={onStop} />
      }
      topAddons={
        isLoading ? (
          <Flexbox paddingInline={8}>
            <Skeleton.Button active block size={'small'} />
          </Flexbox>
        ) : (
          <>
            <Files />
            <ActionBar
              leftActions={MOBILE_CHAT_LEFT_ACTIONS}
              padding={'0 8px'}
              rightActions={defaultRightActions}
            />
          </>
        )
      }
      value={value}
    />
  );
});

MobileChatInput.displayName = 'MobileChatInput';

export default MobileChatInput;
