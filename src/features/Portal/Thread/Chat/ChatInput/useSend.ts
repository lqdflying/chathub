import { SendMessageParams } from '@lobechat/types';
import { useCallback, useMemo, useState } from 'react';

import {
  clearPendingPastedTexts,
  getThreadPastedTextScope,
  joinInputWithPendingPastedTexts,
} from '@/features/ChatInput/pastedText';
import { useGeminiChineseWarning } from '@/hooks/useGeminiChineseWarning';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/slices/chat';
import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

export type UseSendMessageParams = Pick<
  SendMessageParams,
  'onlyAddUserMessage' | 'isWelcomeQuestion'
>;

export const useSendThreadMessage = () => {
  const [loading, setLoading] = useState(false);
  const canNotSend = useChatStore(threadSelectors.isSendButtonDisabledByMessage);
  const generating = useChatStore((s) => threadSelectors.isThreadAIGenerating(s));
  const stopGenerate = useChatStore((s) => s.stopGenerateMessage);
  const portalThreadId = useChatStore((s) => s.portalThreadId);
  // scope the Stop to this thread so it can't abort the main conversation's pre-send compaction
  const stop = useCallback(
    () => void stopGenerate({ threadId: portalThreadId ?? null }),
    [stopGenerate, portalThreadId],
  );
  const [sendMessage, updateInputMessage] = useChatStore((s) => [
    s.sendThreadMessage,
    s.updateThreadInputMessage,
  ]);
  const checkGeminiChineseWarning = useGeminiChineseWarning();

  const handleSend = async (params: UseSendMessageParams = {}) => {
    const store = useChatStore.getState();

    if (threadSelectors.isThreadAIGenerating(store)) return;
    const canNotSend = threadSelectors.isSendButtonDisabledByMessage(store);

    if (canNotSend) return;

    const threadInputEditor = store.threadInputEditor;

    if (!threadInputEditor) {
      console.warn('not found threadInputEditor instance');
      return;
    }

    const pastedTextScope = getThreadPastedTextScope(store.portalThreadId);
    const inputMessage = joinInputWithPendingPastedTexts(
      threadInputEditor.getMarkdownContent(),
      pastedTextScope,
    );

    // if there is no message and no image, then we should not send the message
    if (!inputMessage) return;

    // Check for Chinese text warning with Gemini model
    const agentStore = getAgentStoreState();
    const currentModel = agentSelectors.currentAgentModel(agentStore);
    const shouldContinue = await checkGeminiChineseWarning({
      model: currentModel,
      prompt: inputMessage,
      scenario: 'chat',
    });

    if (!shouldContinue) return;

    updateInputMessage(inputMessage);

    void sendMessage({ message: inputMessage, ...params }).catch((error) => {
      console.error('Failed to send thread message', error);
    });

    updateInputMessage('');
    clearPendingPastedTexts(pastedTextScope);
    threadInputEditor.clearContent();
    threadInputEditor.focus();
  };

  const send = async (params: UseSendMessageParams = {}) => {
    setLoading(true);
    await handleSend(params);
    setLoading(false);
  };

  return useMemo(
    () => ({ disabled: canNotSend, generating, loading, send, stop }),
    [canNotSend, send, generating, stop, loading],
  );
};
