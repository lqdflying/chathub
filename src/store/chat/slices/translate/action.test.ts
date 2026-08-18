import { chainLangDetect } from '@lobechat/prompts';
import { chainTranslate } from '@lobechat/prompts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
import { chatService } from '@/services/chat';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { authSelectors, systemAgentSelectors } from '@/store/user/selectors';

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
vi.mock('@/helpers/durableConversationGeneration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/helpers/durableConversationGeneration')>()),
  isClientDurableConversationGenerationEnabled: vi.fn(() => false),
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

    it('uses a new durable request key for each translation of the same message', async () => {
      vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
      vi.spyOn(systemAgentSelectors, 'translation').mockReturnValue({
        model: 'gpt-5-mini',
        provider: 'openai',
      } as any);
      const enqueue = vi.spyOn(conversationGenerationService, 'enqueue').mockImplementation(
        async (input: any) =>
          ({
            id: `cgo-${input.idempotencyKey}`,
            kind: 'translation',
            lane: 'lane-translation',
            laneGeneration: 1,
            revision: 1,
          }) as any,
      );
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';

      act(() => {
        useChatStore.setState({
          activeId: 'session',
          attachConversationGeneration: vi.fn(),
          messagesMap: {
            [messageMapKey('session')]: [
              {
                content: 'Hello World',
                createdAt: Date.now(),
                id: messageId,
                meta: {},
                role: 'user',
                sessionId: 'test',
                topicId: 'test',
                updatedAt: Date.now(),
              },
            ],
          },
        });
      });

      await act(async () => {
        await result.current.translateMessage(messageId, 'zh-CN');
      });
      await act(async () => {
        await result.current.translateMessage(messageId, 'zh-CN');
      });

      expect(enqueue).toHaveBeenCalledTimes(2);
      const keys = enqueue.mock.calls.map(([input]) => input.idempotencyKey);
      expect(keys[0]).not.toEqual(keys[1]);
      expect(keys[0]).toContain('translation');
      expect(keys[1]).toContain('translation');
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
