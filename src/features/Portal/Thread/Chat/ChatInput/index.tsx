'use client';

import { Alert } from '@lobehub/ui';
import Link from 'next/link';
import { memo } from 'react';
import { Trans } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { type ActionKeys, ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import {
  PastedTextScopeProvider,
  getThreadPastedTextScope,
  useClearPastedTextsOnScopeChange,
} from '@/features/ChatInput/pastedText';
import WideScreenContainer from '@/features/Conversation/components/WideScreenContainer';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { useSendThreadMessage } from './useSend';

const threadActions: ActionKeys[] = ['typo', 'stt', 'portalToken'];

const Desktop = memo(() => {
  const [hideThreadLimitAlert, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.systemStatus(s).hideThreadLimitAlert,
    s.updateSystemStatus,
  ]);

  const { send, disabled, generating, stop } = useSendThreadMessage();
  const portalThreadId = useChatStore((s) => s.portalThreadId);
  const pastedTextScope = getThreadPastedTextScope(portalThreadId);
  useClearPastedTextsOnScopeChange(pastedTextScope);

  return (
    <WideScreenContainer>
      {!hideThreadLimitAlert && (
        <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
          <Alert
            closable
            message={
              <Trans i18nKey={'notSupportMultiModals'} ns={'thread'}>
                子话题暂不支持文件/图片上传，如有需求，欢迎留言：
                <Link
                  href={'https://github.com/lobehub/lobe-chat/discussions/4717'}
                  style={{ textDecoration: 'underline' }}
                >
                  💬 讨论
                </Link>
              </Trans>
            }
            onClose={() => {
              updateSystemStatus({ hideThreadLimitAlert: true });
            }}
            type={'info'}
          />
        </Flexbox>
      )}

      <PastedTextScopeProvider scope={pastedTextScope}>
        <ChatInputProvider
          chatInputEditorRef={(instance) => {
            if (!instance) return;
            useChatStore.setState({ threadInputEditor: instance });
          }}
          leftActions={threadActions}
          onSend={() => {
            send();
          }}
          sendButtonProps={{
            disabled,
            generating,
            onStop: stop,
            shape: 'round',
          }}
        >
          <DesktopChatInput />
        </ChatInputProvider>
      </PastedTextScopeProvider>
    </WideScreenContainer>
  );
});

export default Desktop;
