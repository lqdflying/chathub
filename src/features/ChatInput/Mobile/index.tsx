'use client';

import { ChatInput, ChatInputActionBar } from '@lobehub/editor/react';
import { createStyles } from 'antd-style';
import dynamic from 'next/dynamic';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import PastedTextList from '@/features/ChatInput/pastedText/PastedTextList';
import { useClearPastedTextsOnChatChange } from '@/features/ChatInput/pastedText/useClearOnChatChange';
import { useChatInputStore } from '@/features/ChatInput/store';

import ActionBar from '../ActionBar';
import InputEditor from '../InputEditor';
import SendArea from '../SendArea';

const FilePreview = dynamic(() => import('./FilePreview'), { ssr: false });

const useStyles = createStyles(({ css, token }) => ({
  container: css``,
  fullscreen: css`
    position: absolute;
    z-index: 100;
    inset: 0;

    width: 100%;
    height: 100%;
    padding: 12px;

    background: ${token.colorBgLayout};
  `,
}));

const DesktopChatInput = memo(() => {
  const [slashMenuRef, expand] = useChatInputStore((s) => [s.slashMenuRef, s.expand]);
  const leftActions = useChatInputStore((s) => s.leftActions);

  const { styles, cx } = useStyles();

  useClearPastedTextsOnChatChange();

  const extraNode = (
    <>
      {leftActions.flat().includes('fileUpload') && <FilePreview />}
      <PastedTextList />
    </>
  );

  return (
    <>
      {!expand && extraNode}
      <Flexbox
        className={cx(styles.container, expand && styles.fullscreen)}
        paddingBlock={'0 12px'}
        paddingInline={12}
      >
        <ChatInput
          footer={
            <ChatInputActionBar
              left={<div />}
              right={<SendArea />}
              style={{
                paddingRight: 8,
              }}
            />
          }
          fullscreen={expand}
          header={<ChatInputActionBar left={<ActionBar />} />}
          slashMenuRef={slashMenuRef}
        >
          {expand && extraNode}
          <InputEditor defaultRows={1} />
        </ChatInput>
      </Flexbox>
    </>
  );
});

DesktopChatInput.displayName = 'DesktopChatInput';

export default DesktopChatInput;
