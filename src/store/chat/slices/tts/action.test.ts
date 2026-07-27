import { act, renderHook, waitFor } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
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
  describe('clearTTS', () => {
    it('should clear TTS for a message and refresh messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';

      await act(async () => {
        await result.current.clearTTS(messageId);
      });

      expect(messageService.updateMessageTTS).toHaveBeenCalledWith(messageId, false);
    });
  });

  describe('updateMessageTTS', () => {
    it('does not persist TTS state during an active owner mismatch', async () => {
      vi.spyOn(authSelectors, 'hasActiveUserStateOwnerMismatch').mockReturnValue(true);

      await useChatStore.getState().updateMessageTTS('message-id', { voice: 'alloy' });

      expect(messageService.updateMessageTTS).not.toHaveBeenCalled();
    });

    it('does not refresh after ownership invalidates during TTS persistence', async () => {
      const persistedTTS = createDeferred<void>();
      (messageService.updateMessageTTS as Mock).mockReturnValue(persistedTTS.promise);
      const refreshMessages = vi.fn();
      useChatStore.setState({
        activeId: 'session-id',
        activeTopicId: 'topic-id',
        refreshMessages,
      });

      const updatePromise = useChatStore
        .getState()
        .updateMessageTTS('message-id', { voice: 'alloy' });
      await waitFor(() => {
        expect(messageService.updateMessageTTS).toHaveBeenCalled();
      });

      act(() => {
        useUserStore.setState({
          ownershipInvalidationGeneration:
            useUserStore.getState().ownershipInvalidationGeneration + 1,
        });
      });
      persistedTTS.resolve(undefined);
      await updatePromise;

      expect(refreshMessages).not.toHaveBeenCalled();
    });
  });
});
