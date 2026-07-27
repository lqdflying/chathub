import { ChatTTS } from '@lobechat/types';
import { StateCreator } from 'zustand/vanilla';

import { messageService } from '@/services/message';
import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { ChatStore } from '@/store/chat/store';
import { useUserStore } from '@/store/user';

/**
 * enhance chat action like translate,tts
 */
export interface ChatTTSAction {
  clearTTS: (id: string) => Promise<void>;
  ttsMessage: (
    id: string,
    state?: { contentMd5?: string; file?: string; voice?: string },
  ) => Promise<void>;
  updateMessageTTS: (id: string, data: Partial<ChatTTS> | false) => Promise<void>;
}

export const chatTTS: StateCreator<ChatStore, [['zustand/devtools', never]], [], ChatTTSAction> = (
  set,
  get,
) => ({
  clearTTS: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    await get().updateMessageTTS(id, false);
  },

  ttsMessage: async (id, state = {}) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    await get().updateMessageTTS(id, state);
  },

  updateMessageTTS: async (id, data) => {
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
    await messageService.updateMessageTTS(id, data);
    if (isCurrentRequest()) await get().refreshMessages();
  },
});
