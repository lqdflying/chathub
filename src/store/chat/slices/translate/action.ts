import { chainLangDetect, chainTranslate } from '@lobechat/prompts';
import { ChatTranslate, TraceNameMap, TracePayload } from '@lobechat/types';
import { produce } from 'immer';
import { StateCreator } from 'zustand/vanilla';

import { supportLocales } from '@/locales/resources';
import { chatService } from '@/services/chat';
import { tryEnqueueConversationGeneration } from '@/services/conversationGeneration';
import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
import { messageService } from '@/services/message';
import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { chatSelectors } from '@/store/chat/selectors';
import { ChatStore } from '@/store/chat/store';
import { globalHelpers } from '@/store/global/helpers';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('enhance');

/**
 * chat translate
 */
export interface ChatTranslateAction {
  clearTranslate: (id: string) => Promise<void>;
  getCurrentTracePayload: (data: Partial<TracePayload>) => TracePayload;
  translateMessage: (id: string, targetLang: string) => Promise<void>;
  updateMessageTranslate: (id: string, data: Partial<ChatTranslate> | false) => Promise<void>;
}

export const chatTranslate: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatTranslateAction
> = (set, get) => ({
  clearTranslate: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    await get().updateMessageTranslate(id, false);
  },
  getCurrentTracePayload: (data) => ({
    sessionId: get().activeId,
    topicId: get().activeTopicId,
    ...data,
  }),

  translateMessage: async (id, targetLang) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId &&
      !!chatSelectors.getMessageById(id)(get());
    const { internal_toggleChatLoading, updateMessageTranslate, internal_dispatchMessage } = get();

    const message = chatSelectors.getMessageById(id)(get());
    if (!message || !isCurrentRequest()) return;

    // Get current agent for translation
    const translationSetting = systemAgentSelectors.translation(useUserStore.getState());

    // create translate extra
    await updateMessageTranslate(id, { content: '', from: '', to: targetLang });
    if (!isCurrentRequest()) return;

    if (
      isClientDurableConversationGenerationEnabled() &&
      translationSetting.model &&
      translationSetting.provider
    ) {
      const operation = await tryEnqueueConversationGeneration({
        config: {
          locale: globalHelpers.getCurrentLanguage(),
          model: translationSetting.model,
          provider: translationSetting.provider,
          translation: { messageId: id, to: targetLang },
        },
        kind: 'translation',
        replaceActive: true,
        sessionId: requestedSessionId,
        topicId: requestedTopicId ?? undefined,
      });
      if (operation) {
        get().attachConversationGeneration({
          assistantMessageId: id,
          generation: requestedGeneration,
          kind: operation.kind,
          lane: operation.lane,
          laneGeneration: operation.laneGeneration,
          operationId: operation.id,
          revision: operation.revision,
          sessionId: requestedSessionId,
          threadId: operation.threadId || undefined,
          topicId: requestedTopicId ?? undefined,
          userScope: accountMutationSnapshot.scope,
        });
        return;
      }
    }

    internal_toggleChatLoading(true, id, n('translateMessage(start)', { id }));

    let content = '';
    let from = '';

    // detect from language
    chatService.fetchPresetTaskResult({
      onFinish: async (data) => {
        if (!isCurrentRequest()) return;
        if (data && supportLocales.includes(data)) from = data;

        await updateMessageTranslate(id, { content, from, to: targetLang });
      },
      params: merge(translationSetting, chainLangDetect(message.content)),
      trace: get().getCurrentTracePayload({ traceName: TraceNameMap.LanguageDetect }),
    });

    // translate to target language
    await chatService.fetchPresetTaskResult({
      onFinish: async (content) => {
        if (!isCurrentRequest()) return;
        await updateMessageTranslate(id, { content, from, to: targetLang });
        if (isCurrentRequest()) internal_toggleChatLoading(false, id);
      },
      onMessageHandle: (chunk) => {
        if (!isCurrentRequest()) return;
        switch (chunk.type) {
          case 'text': {
            internal_dispatchMessage({
              id,
              key: 'translate',
              type: 'updateMessageExtra',
              value: produce({ content: '', from, to: targetLang }, (draft) => {
                content += chunk.text;
                draft.content += content;
              }),
            });
            break;
          }
        }
      },
      params: merge(translationSetting, chainTranslate(message.content, targetLang)),
      trace: get().getCurrentTracePayload({ traceName: TraceNameMap.Translator }),
    });
  },

  updateMessageTranslate: async (id, data) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId;
    await messageService.updateMessageTranslate(id, data);

    if (isCurrentRequest()) await get().refreshMessages();
  },
});
