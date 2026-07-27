import { chainLangDetect } from '@lobechat/prompts';
import { chainTranslate } from '@lobechat/prompts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { useChatStore } from '../../store';

// Mock messageService 和 chatService
vi.mock('@/services/message', () => ({
  messageService: {
    updateMessageTTS: vi.fn(),
    updateMessageTranslate: vi.fn(),
    updateMessage: vi.fn(),
  },
}));

vi.mock('@/services/chat', () => ({
  chatService: {
    fetchPresetTaskResult: vi.fn(),
  },
}));

vi.mock('@/chains/langDetect', () => ({
  chainLangDetect: vi.fn(),
}));

vi.mock('@/chains/translate', () => ({
  chainTranslate: vi.fn(),
}));

// Mock supportLocales
vi.mock('@/locales/options', () => ({
  supportLocales: ['en-US', 'zh-CN'],
}));

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState(
    {
      // ... 初始状态
    },
    false,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatEnhanceAction', () => {
  describe('translateMessage', () => {
    it('should translate a message to the target language and refresh messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const targetLang = 'zh-CN';
      const messageContent = 'Hello World';
      const detectedLang = 'en-US';

      act(() => {
        useChatStore.setState({
          activeId: 'session',
          messagesMap: {
            [messageMapKey('session')]: [
              {
                id: messageId,
                content: messageContent,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                role: 'user',
                sessionId: 'test',
                topicId: 'test',
                meta: {},
              },
            ],
          },
        });
      });

      (chatService.fetchPresetTaskResult as Mock).mockImplementation(({ params }) => {
        if (params === chainLangDetect(messageContent)) {
          return Promise.resolve(detectedLang);
        }
        if (params === chainTranslate(messageContent, targetLang)) {
          return Promise.resolve('Hola Mundo');
        }
        return Promise.resolve(undefined);
      });

      await act(async () => {
        await result.current.translateMessage(messageId, targetLang);
      });

      expect(messageService.updateMessageTranslate).toHaveBeenCalled();
    });
  });

  describe('clearTranslate', () => {
    it('should clear translation for a message and refresh messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';

      await act(async () => {
        await result.current.clearTranslate(messageId);
      });

      expect(messageService.updateMessageTranslate).toHaveBeenCalledWith(messageId, false);
    });
  });

  describe('updateMessageTranslate', () => {
    it('does not persist translation during an active owner mismatch', async () => {
      vi.spyOn(authSelectors, 'hasActiveUserStateOwnerMismatch').mockReturnValue(true);

      await useChatStore
        .getState()
        .updateMessageTranslate('message-id', { content: 'translated', from: 'en-US', to: 'zh-CN' });

      expect(messageService.updateMessageTranslate).not.toHaveBeenCalled();
    });

    it('does not refresh after ownership invalidates during translation persistence', async () => {
      const persistedTranslation = createDeferred<void>();
      (messageService.updateMessageTranslate as Mock).mockReturnValue(persistedTranslation.promise);
      const refreshMessages = vi.fn();
      useChatStore.setState({
        activeId: 'session-id',
        activeTopicId: 'topic-id',
        refreshMessages,
      });

      const updatePromise = useChatStore
        .getState()
        .updateMessageTranslate('message-id', { content: 'translated', from: 'en-US', to: 'zh-CN' });
      await waitFor(() => {
        expect(messageService.updateMessageTranslate).toHaveBeenCalled();
      });

      act(() => {
        useUserStore.setState({
          ownershipInvalidationGeneration:
            useUserStore.getState().ownershipInvalidationGeneration + 1,
        });
      });
      persistedTranslation.resolve(undefined);
      await updatePromise;

      expect(refreshMessages).not.toHaveBeenCalled();
    });
  });
});
