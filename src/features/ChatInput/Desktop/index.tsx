'use client';

import { ChatInput, ChatInputActionBar } from '@lobehub/editor/react';
import { Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { rgba } from 'polished';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import { useChatInputStore } from '@/features/ChatInput/store';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import ActionBar from '../ActionBar';
import InputEditor from '../InputEditor';
import SendArea from '../SendArea';
import TypoBar from '../TypoBar';
import FilePreview from './FilePreview';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    margin-block-start: -5px;
    transition: background-color 160ms ${token.motionEaseOut};

    .show-on-hover {
      opacity: 0;
    }

    &:hover {
      .show-on-hover {
        opacity: 1;
      }
    }
  `,
  footnote: css`
    font-size: 10px;
  `,
  fullscreen: css`
    position: absolute;
    z-index: 100;
    inset: 0;

    width: 100%;
    height: 100%;
    padding: 12px;

    background: ${token.colorBgContainerSecondary};
  `,
  inputShell: css`
    overflow: hidden;

    width: 100%;
    min-width: 0;
    border: 1px solid ${token.colorBorder};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorBgElevated};
    box-shadow:
      0 1px 0 ${token.colorFillQuaternary},
      0 10px 28px ${rgba(token.colorFillSecondary, 0.24)};

    transition:
      border-color 160ms ${token.motionEaseOut},
      box-shadow 160ms ${token.motionEaseOut};

    &:focus-within,
    &:hover {
      border-color: ${token.colorPrimaryBorder};
      box-shadow:
        0 0 0 2px ${token.colorPrimaryBg},
        0 10px 28px ${rgba(token.colorFillSecondary, 0.28)};
    }
  `,
}));

const DesktopChatInput = memo<{ showFootnote?: boolean }>(({ showFootnote }) => {
  const { t } = useTranslation('chat');
  const [chatInputHeight, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.chatInputHeight(s),
    s.updateSystemStatus,
  ]);
  const [slashMenuRef, expand, showTypoBar, editor, leftActions] = useChatInputStore((s) => [
    s.slashMenuRef,
    s.expand,
    s.showTypoBar,
    s.editor,
    s.leftActions,
  ]);

  const { styles, cx } = useStyles();

  const chatKey = useChatStore(chatSelectors.currentChatKey);

  useEffect(() => {
    if (editor) editor.focus();
  }, [chatKey, editor]);

  const fileNode = leftActions.flat().includes('fileUpload') && <FilePreview />;

  return (
    <>
      {!expand && fileNode}
      <Flexbox
        className={cx(styles.container, expand && styles.fullscreen)}
        gap={8}
        paddingBlock={showFootnote ? '0 8px' : '0 12px'}
        paddingInline={12}
      >
        <Flexbox className={styles.inputShell}>
          <ChatInput
            defaultHeight={chatInputHeight || 32}
            footer={
              <ChatInputActionBar
                left={<ActionBar />}
                right={<SendArea />}
                style={{
                  paddingInline: '8px 8px',
                }}
              />
            }
            fullscreen={expand}
            header={showTypoBar && <TypoBar />}
            maxHeight={320}
            minHeight={36}
            onSizeChange={(height) => {
              updateSystemStatus({ chatInputHeight: height });
            }}
            resize={true}
            slashMenuRef={slashMenuRef}
          >
            {expand && fileNode}
            <InputEditor />
          </ChatInput>
        </Flexbox>
        {showFootnote && !expand && (
          <Center style={{ pointerEvents: 'none', zIndex: 100 }}>
            <Text className={styles.footnote} type={'secondary'}>
              {t('input.disclaimer')}
            </Text>
          </Center>
        )}
      </Flexbox>
    </>
  );
});

DesktopChatInput.displayName = 'DesktopChatInput';

export default DesktopChatInput;
