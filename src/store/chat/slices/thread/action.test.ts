import { UIChatMessage } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mutate } from 'swr';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT, THREAD_DRAFT_ID } from '@/const/message';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { threadService } from '@/services/thread';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useSessionStore } from '@/store/session';
import { ThreadItem, ThreadStatus, ThreadType } from '@/types/topic';

import { useChatStore } from '../../store';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

// Mock threadService
vi.mock('@/services/thread', () => ({
  threadService: {
    createThreadWithMessage: vi.fn(),
    getThreads: vi.fn(),
    removeThread: vi.fn(),
    updateThread: vi.fn(),
  },
}));

// Mock chatService
vi.mock('@/services/chat', () => ({
  chatService: {
    fetchPresetTaskResult: vi.fn(),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    getConversationVersion: vi.fn().mockResolvedValue(1),
  },
}));

// Mock mutate from SWR
vi.mock('swr', async () => {
  const actual = await vi.importActual('swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

// Mock store helpers
vi.mock('@/store/global/helpers', () => ({
  globalHelpers: {
    getCurrentLanguage: vi.fn(() => 'en-US'),
  },
}));

vi.mock('@/store/session', () => ({
  useSessionStore: {
    getState: vi.fn(() => ({
      triggerSessionUpdate: vi.fn(),
    })),
  },
}));

let hasActiveUserStateOwnerMismatch = false;
vi.mock('@/store/user', () => {
  const userState = {
    authUserId: 'test-user',
    isUserStateInit: true,
    isLoaded: true,
    isSignedIn: true,
    ownershipInvalidationGeneration: 0,
    user: { id: 'test-user' },
    userStateScope: 'user:test-user',
  };
  const useUserStore = (<Value>(selector: (state: typeof userState) => Value) =>
    selector(userState)) as {
    <Value>(selector: (state: typeof userState) => Value): Value;
    getState: () => typeof userState;
  };
  useUserStore.getState = () => userState;

  return { useUserStore };
});

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    currentUserScope: () => 'user:test-user',
    hasActiveUserStateOwnerMismatch: () => hasActiveUserStateOwnerMismatch,
  },
  systemAgentSelectors: {
    thread: vi.fn(() => ({})),
  },
  userProfileSelectors: {
    userAvatar: vi.fn(() => 'avatar-url'),
  },
}));

const createDeferred = <Value>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });

  return { promise, reject, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  hasActiveUserStateOwnerMismatch = false;
  useChatStore.setState(
    {
      activeId: 'test-session-id',
      activeTopicId: 'test-topic-id',
      conversationClearGeneration: 0,
      creatingThreadId: undefined,
      isCreatingThread: false,
      isCreatingThreadMessage: false,
      messagesMap: {},
      newThreadMode: ThreadType.Continuation,
      portalThreadId: undefined,
      startToForkThread: undefined,
      threadInputMessage: '',
      threadLoadingIds: [],
      threadMaps: {},
      threadStartMessageId: undefined,
      threadTitleSummaryOperations: {},
      threadsInit: false,
    },
    false,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('thread action', () => {
  describe('updateThreadInputMessage', () => {
    it('should update thread input message', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.updateThreadInputMessage('test message');
      });

      expect(result.current.threadInputMessage).toBe('test message');
    });

    it('should not update if message is the same', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ threadInputMessage: 'test message' });
      });

      const stateBefore = useChatStore.getState();

      act(() => {
        result.current.updateThreadInputMessage('test message');
      });

      expect(useChatStore.getState()).toBe(stateBefore);
    });
  });

  describe('openThreadCreator', () => {
    it('should set thread creator state and open portal', () => {
      const { result } = renderHook(() => useChatStore());
      const togglePortalSpy = vi.spyOn(result.current, 'togglePortal');

      act(() => {
        result.current.openThreadCreator('message-id');
      });

      expect(result.current.threadStartMessageId).toBe('message-id');
      expect(result.current.portalThreadId).toBeUndefined();
      expect(result.current.startToForkThread).toBe(true);
      expect(togglePortalSpy).toHaveBeenCalledWith(true);
    });
  });

  describe('openThreadInPortal', () => {
    it('should set portal thread state and open portal', () => {
      const { result } = renderHook(() => useChatStore());
      const togglePortalSpy = vi.spyOn(result.current, 'togglePortal');

      act(() => {
        result.current.openThreadInPortal('thread-id', 'source-message-id');
      });

      expect(result.current.portalThreadId).toBe('thread-id');
      expect(result.current.threadStartMessageId).toBe('source-message-id');
      expect(result.current.startToForkThread).toBe(false);
      expect(togglePortalSpy).toHaveBeenCalledWith(true);
    });
  });

  describe('closeThreadPortal', () => {
    it('should clear thread portal state and close portal', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          portalThreadId: 'thread-id',
          startToForkThread: true,
          threadStartMessageId: 'message-id',
        });
      });

      const togglePortalSpy = vi.spyOn(result.current, 'togglePortal');
      const syncSpy = vi
        .spyOn(result.current, 'syncActiveConversationGenerations')
        .mockRejectedValue(new Error('offline'));

      act(() => {
        result.current.closeThreadPortal();
      });

      expect(result.current.portalThreadId).toBeUndefined();
      expect(result.current.threadStartMessageId).toBeUndefined();
      expect(result.current.startToForkThread).toBeUndefined();
      expect(togglePortalSpy).toHaveBeenCalledWith(false);
      expect(syncSpy).toHaveBeenCalled();
    });
  });

  describe('switchThread', () => {
    it('should set active thread id', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.switchThread('thread-id');
      });

      expect(result.current.activeThreadId).toBe('thread-id');
    });
  });

  describe('createThread', () => {
    it('does not start thread creation during an active owner mismatch', async () => {
      hasActiveUserStateOwnerMismatch = true;
      const { result } = renderHook(() => useChatStore());

      const createResult = await result.current.createThread({
        message: { content: 'test', role: 'user', sessionId: 'test-session-id' },
        sourceMessageId: 'source-msg-id',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
      });

      expect(createResult).toEqual({ messageId: '', threadId: '' });
      expect(threadService.createThreadWithMessage).not.toHaveBeenCalled();
      expect(useChatStore.getState()).toMatchObject({
        creatingThreadId: undefined,
        isCreatingThread: false,
      });
    });

    it('should create thread with message and return ids', async () => {
      const { result } = renderHook(() => useChatStore());

      const mockResult = { messageId: 'new-message-id', threadId: 'new-thread-id' };
      (threadService.createThreadWithMessage as Mock).mockResolvedValue(mockResult);

      let createResult;
      await act(async () => {
        createResult = await result.current.createThread({
          message: {
            content: 'test message',
            role: 'user',
            sessionId: 'test-session-id',
          },
          sourceMessageId: 'source-msg-id',
          topicId: 'test-topic-id',
          type: ThreadType.Continuation,
        });
      });

      expect(threadService.createThreadWithMessage).toHaveBeenCalledWith({
        message: {
          content: 'test message',
          role: 'user',
          sessionId: 'test-session-id',
        },
        sourceMessageId: 'source-msg-id',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
      });
      expect(createResult).toEqual(mockResult);
      expect(result.current.isCreatingThread).toBe(false);
    });

    it('does not continue thread creation after ownership becomes invalid mid-flight', async () => {
      const createdThread = createDeferred<{ messageId: string; threadId: string }>();
      (threadService.createThreadWithMessage as Mock).mockReturnValue(createdThread.promise);
      const creationPromise = useChatStore.getState().createThread({
        message: { content: 'test', role: 'user', sessionId: 'test-session-id' },
        sourceMessageId: 'source-msg-id',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
      });
      await waitFor(() => {
        expect(threadService.createThreadWithMessage).toHaveBeenCalled();
      });

      hasActiveUserStateOwnerMismatch = true;
      createdThread.resolve({ messageId: 'stale-message', threadId: 'stale-thread' });
      const createResult = await creationPromise;

      expect(createResult).toEqual({ messageId: '', threadId: '' });
    });

    it('should set isCreatingThread during creation', async () => {
      const { result } = renderHook(() => useChatStore());

      (threadService.createThreadWithMessage as Mock).mockImplementation(async () => {
        expect(useChatStore.getState().isCreatingThread).toBe(true);
        return { messageId: 'message-id', threadId: 'thread-id' };
      });

      await act(async () => {
        await result.current.createThread({
          message: { content: 'test', role: 'user', sessionId: 'test-session-id' },
          sourceMessageId: 'source-msg-id',
          topicId: 'test-topic-id',
          type: ThreadType.Continuation,
        });
      });

      expect(result.current.isCreatingThread).toBe(false);
    });

    it('returns empty ids when an A-to-B-to-A reset completes during creation', async () => {
      const createdThread = createDeferred<{
        messageId: string;
        threadId: string;
      }>();
      (threadService.createThreadWithMessage as Mock).mockReturnValue(createdThread.promise);
      const { result } = renderHook(() => useChatStore());
      let creationPromise!: ReturnType<typeof result.current.createThread>;

      act(() => {
        useChatStore.setState({
          activeId: 'account-a-session',
          activeTopicId: 'account-a-topic',
        });
        creationPromise = result.current.createThread({
          message: { content: 'test', role: 'user', sessionId: 'account-a-session' },
          sourceMessageId: 'account-a-source-message',
          topicId: 'account-a-topic',
          type: ThreadType.Continuation,
        });
      });

      await waitFor(() => {
        expect(threadService.createThreadWithMessage).toHaveBeenCalled();
      });

      act(() => {
        result.current.internal_invalidateConversation();
        useChatStore.setState({
          activeId: 'account-a-returned-session',
          activeTopicId: 'account-a-returned-topic',
        });
      });
      expect(useChatStore.getState()).toMatchObject({
        creatingThreadId: undefined,
        isCreatingThread: false,
      });
      createdThread.resolve({
        messageId: 'stale-account-a-message',
        threadId: 'stale-account-a-thread',
      });

      let createResult!: Awaited<typeof creationPromise>;
      await act(async () => {
        createResult = await creationPromise;
      });

      expect(createResult).toEqual({ messageId: '', threadId: '' });
      expect(useChatStore.getState().isCreatingThread).toBe(false);
    });

    it('clears owned loading state when the service rejects', async () => {
      const serviceError = new Error('thread creation failed');
      (threadService.createThreadWithMessage as Mock).mockRejectedValue(serviceError);
      const { result } = renderHook(() => useChatStore());

      await expect(
        result.current.createThread({
          message: { content: 'test', role: 'user', sessionId: 'test-session-id' },
          sourceMessageId: 'source-msg-id',
          topicId: 'test-topic-id',
          type: ThreadType.Continuation,
        }),
      ).rejects.toBe(serviceError);

      expect(useChatStore.getState()).toMatchObject({
        creatingThreadId: undefined,
        isCreatingThread: false,
      });
    });

    it('does not let an older completion clear a newer creation', async () => {
      const olderCreation = createDeferred<{ messageId: string; threadId: string }>();
      const newerCreation = createDeferred<{ messageId: string; threadId: string }>();
      (threadService.createThreadWithMessage as Mock)
        .mockReturnValueOnce(olderCreation.promise)
        .mockReturnValueOnce(newerCreation.promise);
      const { result } = renderHook(() => useChatStore());

      const olderPromise = result.current.createThread({
        message: { content: 'older', role: 'user', sessionId: 'test-session-id' },
        sourceMessageId: 'older-source',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
      });
      const olderOperationId = useChatStore.getState().creatingThreadId;
      const newerPromise = result.current.createThread({
        message: { content: 'newer', role: 'user', sessionId: 'test-session-id' },
        sourceMessageId: 'newer-source',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
      });
      const newerOperationId = useChatStore.getState().creatingThreadId;

      expect(newerOperationId).toBeDefined();
      expect(newerOperationId).not.toBe(olderOperationId);

      olderCreation.resolve({ messageId: 'older-message', threadId: 'older-thread' });
      await olderPromise;

      expect(useChatStore.getState()).toMatchObject({
        creatingThreadId: newerOperationId,
        isCreatingThread: true,
      });

      newerCreation.resolve({ messageId: 'newer-message', threadId: 'newer-thread' });
      await newerPromise;

      expect(useChatStore.getState()).toMatchObject({
        creatingThreadId: undefined,
        isCreatingThread: false,
      });
    });
  });

  describe('useFetchThreads', () => {
    it('should fetch threads for a given topic id', async () => {
      const topicId = 'test-topic-id';
      const threads: ThreadItem[] = [
        {
          createdAt: new Date(),
          id: 'thread-1',
          lastActiveAt: new Date(),
          sourceMessageId: 'msg-1',
          status: ThreadStatus.Active,
          title: 'Thread 1',
          topicId,
          type: ThreadType.Continuation,
          updatedAt: new Date(),
          userId: 'user-1',
        },
      ];

      (threadService.getThreads as Mock).mockResolvedValue(threads);

      const { result } = renderHook(() => useChatStore().useFetchThreads(true, topicId));

      await waitFor(() => {
        expect(result.current.data).toEqual(threads);
      });

      expect(useChatStore.getState().threadsInit).toBeTruthy();
      expect(useChatStore.getState().threadMaps).toEqual({ [topicId]: threads });
    });

    it('should not fetch when enable is false', async () => {
      const topicId = 'test-topic-id';

      const { result } = renderHook(() => useChatStore().useFetchThreads(false, topicId));

      expect(threadService.getThreads).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });

    it('should not fetch when topicId is undefined', async () => {
      const { result } = renderHook(() => useChatStore().useFetchThreads(true, undefined));

      expect(threadService.getThreads).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });
  });

  describe('refreshThreads', () => {
    it('should trigger SWR mutate for active topic', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeTopicId: 'test-topic-id' });
      });

      await act(async () => {
        await result.current.refreshThreads();
      });

      expect(mutate).toHaveBeenCalledWith([
        'SWR_USE_FETCH_THREADS',
        'user:test-user',
        'test-topic-id',
        ['account-cache-epoch', 0],
      ]);
    });

    it('should not mutate when activeTopicId is undefined', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeTopicId: undefined });
      });

      await act(async () => {
        await result.current.refreshThreads();
      });

      expect(mutate).not.toHaveBeenCalled();
    });
  });

  describe('removeThread', () => {
    it('should remove thread and refresh threads', async () => {
      const { result } = renderHook(() => useChatStore());

      (threadService.removeThread as Mock).mockResolvedValue(undefined);

      const refreshThreadsSpy = vi.spyOn(result.current, 'refreshThreads').mockResolvedValue();

      await act(async () => {
        await result.current.removeThread('thread-id');
      });

      expect(threadService.removeThread).toHaveBeenCalledWith('thread-id');
      expect(refreshThreadsSpy).toHaveBeenCalled();
    });

    it('should clear activeThreadId if removing active thread', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeThreadId: 'thread-id' });
      });

      (threadService.removeThread as Mock).mockResolvedValue(undefined);
      vi.spyOn(result.current, 'refreshThreads').mockResolvedValue();

      await act(async () => {
        await result.current.removeThread('thread-id');
      });

      expect(result.current.activeThreadId).toBeUndefined();
    });

    it('should not clear activeThreadId if removing different thread', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeThreadId: 'active-thread-id' });
      });

      (threadService.removeThread as Mock).mockResolvedValue(undefined);
      vi.spyOn(result.current, 'refreshThreads').mockResolvedValue();

      await act(async () => {
        await result.current.removeThread('different-thread-id');
      });

      expect(result.current.activeThreadId).toBe('active-thread-id');
    });
  });

  describe('updateThreadTitle', () => {
    it('should update thread title via internal_updateThread', async () => {
      const { result } = renderHook(() => useChatStore());

      const internalUpdateSpy = vi
        .spyOn(result.current, 'internal_updateThread')
        .mockResolvedValue();

      await act(async () => {
        await result.current.updateThreadTitle('thread-id', 'New Title');
      });

      expect(internalUpdateSpy).toHaveBeenCalledWith('thread-id', { title: 'New Title' });
    });

    it('does not delegate title persistence during an active owner mismatch', async () => {
      hasActiveUserStateOwnerMismatch = true;
      const { result } = renderHook(() => useChatStore());
      const internalUpdateSpy = vi.spyOn(result.current, 'internal_updateThread');

      await result.current.updateThreadTitle('thread-id', 'New Title');

      expect(internalUpdateSpy).not.toHaveBeenCalled();
    });
  });

  describe('summaryThreadTitle', () => {
    it('should generate and update thread title via AI', async () => {
      const { result } = renderHook(() => useChatStore());

      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: 'thread-id',
        lastActiveAt: new Date(),
        sourceMessageId: 'msg-1',
        status: ThreadStatus.Active,
        title: 'Old Title',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'user-1',
      };

      act(() => {
        useChatStore.setState({
          portalThreadId: 'thread-id',
          threadMaps: {
            'test-topic-id': [mockThread],
          },
        });
      });

      const messages: UIChatMessage[] = [
        {
          content: 'Hello',
          createdAt: Date.now(),
          id: 'msg-1',
          meta: {},
          role: 'user',
          sessionId: 'test-session-id',
          updatedAt: Date.now(),
        },
      ];

      (chatService.fetchPresetTaskResult as Mock).mockImplementation(
        async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({ text: 'New', type: 'text' });
          await onMessageHandle?.({ text: ' Generated', type: 'text' });
          await onMessageHandle?.({ text: ' Title', type: 'text' });
          await onFinish?.('New Generated Title');
        },
      );

      await act(async () => {
        await result.current.summaryThreadTitle('thread-id', messages);
      });

      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
      expect(threadService.updateThread).toHaveBeenCalledWith('thread-id', {
        title: 'New Generated Title',
      });
      expect(useChatStore.getState().threadLoadingIds).not.toContain('thread-id');
      expect(useChatStore.getState().threadMaps['test-topic-id'][0].title).toBe(
        'New Generated Title',
      );
    });

    it('should show loading indicator during generation', async () => {
      const { result } = renderHook(() => useChatStore());

      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: 'thread-id',
        lastActiveAt: new Date(),
        sourceMessageId: 'msg-1',
        status: ThreadStatus.Active,
        title: 'Old Title',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'user-1',
      };

      act(() => {
        useChatStore.setState({
          portalThreadId: 'thread-id',
          threadMaps: {
            'test-topic-id': [mockThread],
          },
        });
      });

      (chatService.fetchPresetTaskResult as Mock).mockImplementation(
        async ({ onLoadingChange, onFinish }) => {
          await onLoadingChange?.(true);
          await onFinish?.('Title');
          await onLoadingChange?.(false);
        },
      );

      await act(async () => {
        await result.current.summaryThreadTitle('thread-id', []);
      });

      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
      expect(useChatStore.getState().threadLoadingIds).not.toContain('thread-id');
    });

    it('should revert title on error', async () => {
      const { result } = renderHook(() => useChatStore());

      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: 'thread-id',
        lastActiveAt: new Date(),
        sourceMessageId: 'msg-1',
        status: ThreadStatus.Active,
        title: 'Old Title',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'user-1',
      };

      act(() => {
        useChatStore.setState({
          portalThreadId: 'thread-id',
          threadMaps: {
            'test-topic-id': [mockThread],
          },
        });
      });

      (chatService.fetchPresetTaskResult as Mock).mockImplementation(async ({ onError }) => {
        await onError?.();
      });

      await act(async () => {
        await result.current.summaryThreadTitle('thread-id', []);
      });

      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
      expect(threadService.updateThread).not.toHaveBeenCalled();
      expect(useChatStore.getState().threadMaps['test-topic-id'][0].title).toBe('Old Title');
      expect(useChatStore.getState().threadLoadingIds).not.toContain('thread-id');
    });

    it('should not run if no portal thread found', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          portalThreadId: undefined,
        });
      });

      await act(async () => {
        await result.current.summaryThreadTitle('thread-id', []);
      });

      expect(chatService.fetchPresetTaskResult).not.toHaveBeenCalled();
    });

    it('ignores stale title stream callbacks after switching portal thread', async () => {
      const { result } = renderHook(() => useChatStore());
      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: 'account-a-thread',
        lastActiveAt: new Date(),
        sourceMessageId: 'account-a-source',
        status: ThreadStatus.Active,
        title: 'Account A Old Title',
        topicId: 'account-a-topic',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'user-1',
      };

      act(() => {
        useChatStore.setState({
          activeTopicId: 'account-a-topic',
          conversationClearGeneration: 0,
          portalThreadId: 'account-a-thread',
          threadMaps: {
            'account-a-topic': [mockThread],
          },
        });
      });

      (chatService.fetchPresetTaskResult as Mock).mockImplementation(
        async ({ onLoadingChange, onMessageHandle, onFinish }) => {
          act(() => {
            useChatStore.setState({
              activeTopicId: 'account-a-other-topic',
              portalThreadId: 'account-a-other-thread',
            });
          });

          await onLoadingChange?.(true);
          await onMessageHandle?.({ text: 'Stale', type: 'text' });
          await onFinish?.('Stale Title');
          await onLoadingChange?.(false);
        },
      );

      await act(async () => {
        await result.current.summaryThreadTitle('account-a-thread', []);
      });

      expect(threadService.updateThread).not.toHaveBeenCalled();
      expect(useChatStore.getState().threadLoadingIds).not.toContain('account-a-thread');
      expect(
        useChatStore.getState().threadTitleSummaryOperations['account-a-thread'],
      ).toBeUndefined();
      expect(useChatStore.getState().threadMaps['account-a-topic'][0].title).toBe(
        'Account A Old Title',
      );
    });

    it('aborts and cleans its owned placeholder when the conversation is invalidated', async () => {
      const threadId = 'thread-to-abort';
      const { result } = renderHook(() => useChatStore());
      let observedAbortController: AbortController | undefined;
      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: threadId,
        lastActiveAt: new Date(),
        sourceMessageId: 'source-message',
        status: ThreadStatus.Active,
        title: 'Original Title',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'test-user',
      };

      act(() => {
        useChatStore.setState({
          portalThreadId: threadId,
          threadMaps: { 'test-topic-id': [mockThread] },
        });
      });

      (chatService.fetchPresetTaskResult as Mock).mockImplementation(
        ({ abortController }) =>
          new Promise((resolve) => {
            observedAbortController = abortController;
            abortController?.signal.addEventListener('abort', () => resolve(undefined), {
              once: true,
            });
          }),
      );

      let summaryPromise!: ReturnType<typeof result.current.summaryThreadTitle>;
      act(() => {
        summaryPromise = result.current.summaryThreadTitle(threadId, []);
      });

      await waitFor(() => {
        expect(observedAbortController).toBeDefined();
        expect(useChatStore.getState().threadLoadingIds).toContain(threadId);
        expect(useChatStore.getState().threadMaps['test-topic-id'][0].title).toBe(LOADING_FLAT);
      });

      act(() => {
        result.current.internal_invalidateConversation();
      });

      await act(async () => {
        await summaryPromise;
      });

      expect(observedAbortController?.signal.aborted).toBe(true);
      expect(useChatStore.getState().threadLoadingIds).not.toContain(threadId);
      expect(useChatStore.getState().threadTitleSummaryOperations).toEqual({});
      expect(useChatStore.getState().threadMaps['test-topic-id'][0].title).toBe('Original Title');
    });

    it('persists the newest overlapping summary after an older write finishes', async () => {
      const threadId = 'overlapping-thread';
      const olderPersistence = createDeferred<void>();
      const { result } = renderHook(() => useChatStore());
      const updateThreadMock = threadService.updateThread as Mock;
      updateThreadMock
        .mockReturnValueOnce(olderPersistence.promise)
        .mockResolvedValueOnce(undefined);
      let summaryInvocation = 0;
      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: threadId,
        lastActiveAt: new Date(),
        sourceMessageId: 'source-message',
        status: ThreadStatus.Active,
        title: 'Original Title',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'test-user',
      };

      act(() => {
        useChatStore.setState({
          portalThreadId: threadId,
          threadMaps: { 'test-topic-id': [mockThread] },
        });
      });

      (chatService.fetchPresetTaskResult as Mock).mockImplementation(async ({ onFinish }) => {
        summaryInvocation += 1;
        await onFinish?.(summaryInvocation === 1 ? 'Older Title' : 'Newest Title');
      });

      let olderSummaryPromise!: ReturnType<typeof result.current.summaryThreadTitle>;
      act(() => {
        olderSummaryPromise = result.current.summaryThreadTitle(threadId, []);
      });

      await waitFor(() => {
        expect(updateThreadMock).toHaveBeenCalledWith(threadId, { title: 'Older Title' });
      });

      let newerSummaryPromise!: ReturnType<typeof result.current.summaryThreadTitle>;
      act(() => {
        newerSummaryPromise = result.current.summaryThreadTitle(threadId, []);
      });

      await waitFor(() => {
        expect(useChatStore.getState().threadMaps['test-topic-id'][0].title).toBe('Newest Title');
      });
      expect(updateThreadMock).toHaveBeenCalledTimes(1);

      olderPersistence.resolve();
      await act(async () => {
        await Promise.all([olderSummaryPromise, newerSummaryPromise]);
      });

      expect(updateThreadMock.mock.calls).toEqual([
        [threadId, { title: 'Older Title' }],
        [threadId, { title: 'Newest Title' }],
      ]);
      expect(useChatStore.getState().threadMaps['test-topic-id'][0].title).toBe('Newest Title');
      expect(useChatStore.getState().threadLoadingIds).not.toContain(threadId);
      expect(useChatStore.getState().threadTitleSummaryOperations).toEqual({});
    });
  });

  describe('sendThreadMessage', () => {
    describe('validation', () => {
      it('should not send when activeId is undefined', async () => {
        const { result } = renderHook(() => useChatStore());

        act(() => {
          useChatStore.setState({ activeId: undefined });
        });

        await act(async () => {
          await result.current.sendThreadMessage({ message: 'test' });
        });

        expect(useChatStore.getState().isCreatingThreadMessage).toBeFalsy();
      });

      it('should not send when activeTopicId is undefined', async () => {
        const { result } = renderHook(() => useChatStore());

        act(() => {
          useChatStore.setState({ activeTopicId: undefined });
        });

        await act(async () => {
          await result.current.sendThreadMessage({ message: 'test' });
        });

        expect(useChatStore.getState().isCreatingThreadMessage).toBeFalsy();
      });

      it('should not send when message is empty', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendThreadMessage({ message: '' });
        });

        expect(useChatStore.getState().isCreatingThreadMessage).toBeFalsy();
      });
    });

    describe('new thread creation flow', () => {
      it('does not reopen a stale thread after an A-to-B-to-A reset', async () => {
        const createdThread = createDeferred<{
          messageId: string;
          threadId: string;
        }>();
        vi.spyOn(messageService, 'getConversationVersion').mockResolvedValue(7);
        const { result } = renderHook(() => useChatStore());

        act(() => {
          useChatStore.setState({
            newThreadMode: ThreadType.Continuation,
            portalThreadId: undefined,
            threadStartMessageId: 'account-a-source-message',
          });
        });

        vi.spyOn(result.current, 'createThread').mockReturnValue(createdThread.promise);
        const refreshThreadsSpy = vi.spyOn(result.current, 'refreshThreads').mockResolvedValue();
        const refreshMessagesSpy = vi.spyOn(result.current, 'refreshMessages').mockResolvedValue();
        const openThreadSpy = vi.spyOn(result.current, 'openThreadInPortal');
        const coreProcessSpy = vi
          .spyOn(result.current, 'internal_coreProcessMessage')
          .mockResolvedValue();
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('account-a-temp');
        vi.spyOn(result.current, 'internal_toggleMessageLoading');
        let sendPromise!: ReturnType<typeof result.current.sendThreadMessage>;

        act(() => {
          sendPromise = result.current.sendThreadMessage({ message: 'account A message' });
        });

        await waitFor(() => {
          expect(result.current.createThread).toHaveBeenCalled();
        });

        act(() => {
          useChatStore.setState({
            activeId: 'account-a-returned-session',
            activeTopicId: 'account-a-returned-topic',
            conversationClearGeneration: 1,
            isCreatingThreadMessage: false,
            portalThreadId: undefined,
            threadStartMessageId: undefined,
          });
        });
        createdThread.resolve({
          messageId: 'stale-account-a-message',
          threadId: 'stale-account-a-thread',
        });

        await act(async () => {
          await sendPromise;
        });

        expect(refreshThreadsSpy).not.toHaveBeenCalled();
        expect(refreshMessagesSpy).not.toHaveBeenCalled();
        expect(openThreadSpy).not.toHaveBeenCalled();
        expect(coreProcessSpy).not.toHaveBeenCalled();
        expect(useChatStore.getState().portalThreadId).toBeUndefined();
        expect(useChatStore.getState().isCreatingThreadMessage).toBe(false);
      });

      it('should create new thread and send first message', async () => {
        const { result } = renderHook(() => useChatStore());

        act(() => {
          useChatStore.setState({
            newThreadMode: ThreadType.Continuation,
            portalThreadId: undefined,
            threadStartMessageId: 'source-msg-id',
          });
        });

        const createThreadSpy = vi
          .spyOn(result.current, 'createThread')
          .mockResolvedValue({ messageId: 'new-msg-id', threadId: 'new-thread-id' });

        const refreshThreadsSpy = vi.spyOn(result.current, 'refreshThreads').mockResolvedValue();
        const refreshMessagesSpy = vi.spyOn(result.current, 'refreshMessages').mockResolvedValue();
        const openThreadSpy = vi.spyOn(result.current, 'openThreadInPortal');
        const coreProcessSpy = vi
          .spyOn(result.current, 'internal_coreProcessMessage')
          .mockResolvedValue();
        vi.spyOn(result.current, 'internal_createTmpMessage');
        vi.spyOn(result.current, 'internal_toggleMessageLoading');

        await act(async () => {
          await result.current.sendThreadMessage({ message: 'test message' });
        });

        expect(createThreadSpy).toHaveBeenCalledWith({
          message: expect.objectContaining({
            content: 'test message',
            role: 'user',
            sessionId: 'test-session-id',
            threadId: undefined,
            topicId: 'test-topic-id',
          }),
          sourceMessageId: 'source-msg-id',
          topicId: 'test-topic-id',
          type: ThreadType.Continuation,
        });

        expect(refreshThreadsSpy).toHaveBeenCalled();
        expect(refreshMessagesSpy).toHaveBeenCalled();
        expect(openThreadSpy).toHaveBeenCalledWith('new-thread-id', 'source-msg-id');
        expect(coreProcessSpy).toHaveBeenCalled();
      });

      it('should use temp message with THREAD_DRAFT_ID for optimistic update', async () => {
        const { result } = renderHook(() => useChatStore());

        act(() => {
          useChatStore.setState({
            portalThreadId: undefined,
            threadStartMessageId: 'source-msg-id',
          });
        });

        const createTmpSpy = vi
          .spyOn(result.current, 'internal_createTmpMessage')
          .mockReturnValue('temp-msg-id');

        vi.spyOn(result.current, 'createThread').mockResolvedValue({
          messageId: 'new-msg-id',
          threadId: 'new-thread-id',
        });
        vi.spyOn(result.current, 'refreshThreads').mockResolvedValue();
        vi.spyOn(result.current, 'refreshMessages').mockResolvedValue();
        vi.spyOn(result.current, 'openThreadInPortal');
        vi.spyOn(result.current, 'internal_coreProcessMessage').mockResolvedValue();
        vi.spyOn(result.current, 'internal_toggleMessageLoading');

        await act(async () => {
          await result.current.sendThreadMessage({ message: 'test message' });
        });

        expect(createTmpSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            threadId: THREAD_DRAFT_ID,
          }),
        );
      });

      it('should auto-summarize thread title after first message', async () => {
        const { result } = renderHook(() => useChatStore());

        const mockThread: ThreadItem = {
          createdAt: new Date(),
          id: 'new-thread-id',
          lastActiveAt: new Date(),
          sourceMessageId: 'msg-1',
          status: ThreadStatus.Active,
          title: 'test message',
          topicId: 'test-topic-id',
          type: ThreadType.Continuation,
          updatedAt: new Date(),
          userId: 'user-1',
        };

        act(() => {
          useChatStore.setState({
            messagesMap: {
              [messageMapKey('test-session-id', 'test-topic-id')]: [
                {
                  content: 'test',
                  createdAt: Date.now(),
                  id: 'msg-1',
                  meta: {},
                  role: 'user',
                  sessionId: 'test-session-id',
                  updatedAt: Date.now(),
                },
              ],
            },
            portalThreadId: undefined,
            threadStartMessageId: 'source-msg-id',
          });
        });

        vi.spyOn(result.current, 'createThread').mockResolvedValue({
          messageId: 'new-msg-id',
          threadId: 'new-thread-id',
        });

        vi.spyOn(result.current, 'refreshThreads').mockImplementation(async () => {
          act(() => {
            useChatStore.setState({
              threadMaps: { 'test-topic-id': [mockThread] },
            });
          });
        });
        vi.spyOn(result.current, 'refreshMessages').mockResolvedValue();
        vi.spyOn(result.current, 'openThreadInPortal').mockImplementation((threadId) => {
          act(() => {
            useChatStore.setState({ portalThreadId: threadId });
          });
        });
        vi.spyOn(result.current, 'internal_coreProcessMessage').mockResolvedValue();
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('temp-msg-id');
        vi.spyOn(result.current, 'internal_toggleMessageLoading');

        const summaryTitleSpy = vi.spyOn(result.current, 'summaryThreadTitle').mockResolvedValue();

        await act(async () => {
          await result.current.sendThreadMessage({ message: 'test message' });
        });

        expect(summaryTitleSpy).toHaveBeenCalledWith('new-thread-id', expect.any(Array));
      });
    });

    describe('existing thread flow', () => {
      it('stops before generation when the active conversation changes during persistence', async () => {
        const { result } = renderHook(() => useChatStore());
        const createdMessage = createDeferred<string | undefined>();

        act(() => {
          useChatStore.setState({
            activeId: 'account-a-session',
            activeTopicId: 'account-a-topic',
            conversationClearGeneration: 0,
            portalThreadId: 'account-a-thread',
            threadStartMessageId: 'account-a-source',
          });
        });

        vi.spyOn(result.current, 'internal_createMessage').mockReturnValue(createdMessage.promise);
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('account-a-temp');
        const toggleMessageLoadingSpy = vi.spyOn(result.current, 'internal_toggleMessageLoading');
        const coreProcessSpy = vi
          .spyOn(result.current, 'internal_coreProcessMessage')
          .mockResolvedValue();
        const triggerSessionUpdateMock = vi.fn();
        (useSessionStore.getState as Mock).mockReturnValue({
          triggerSessionUpdate: triggerSessionUpdateMock,
        });

        let sendPromise!: ReturnType<typeof result.current.sendThreadMessage>;
        act(() => {
          sendPromise = result.current.sendThreadMessage({ message: 'account A portal message' });
        });

        await waitFor(() => {
          expect(result.current.internal_createMessage).toHaveBeenCalled();
        });

        act(() => {
          useChatStore.setState({
            activeId: 'account-a-other-session',
            activeTopicId: 'account-a-other-topic',
            conversationClearGeneration: 0,
            isCreatingThreadMessage: false,
            portalThreadId: 'account-a-other-thread',
            threadMessageSendingId: undefined,
            threadStartMessageId: 'account-a-other-source',
          });
        });
        createdMessage.resolve('stale-account-a-message');

        await act(async () => {
          await sendPromise;
        });

        expect(coreProcessSpy).not.toHaveBeenCalled();
        expect(triggerSessionUpdateMock).not.toHaveBeenCalled();
        expect(useChatStore.getState()).toMatchObject({
          activeId: 'account-a-other-session',
          activeTopicId: 'account-a-other-topic',
          isCreatingThreadMessage: false,
          portalThreadId: 'account-a-other-thread',
          threadMessageSendingId: undefined,
        });
        expect(toggleMessageLoadingSpy).not.toHaveBeenCalledWith(false, 'account-a-temp');
      });

      it('should append message to existing thread', async () => {
        const { result } = renderHook(() => useChatStore());

        act(() => {
          useChatStore.setState({
            portalThreadId: 'existing-thread-id',
          });
        });

        const createMessageSpy = vi
          .spyOn(result.current, 'internal_createMessage')
          .mockResolvedValue('new-msg-id');
        const coreProcessSpy = vi
          .spyOn(result.current, 'internal_coreProcessMessage')
          .mockResolvedValue();
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('temp-msg-id');
        vi.spyOn(result.current, 'internal_toggleMessageLoading');

        await act(async () => {
          await result.current.sendThreadMessage({ message: 'follow-up message' });
        });

        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: 'follow-up message',
            role: 'user',
            threadId: 'existing-thread-id',
          }),
          { tempMessageId: 'temp-msg-id' },
        );

        expect(coreProcessSpy).toHaveBeenCalledWith(
          expect.any(Array),
          'new-msg-id',
          expect.objectContaining({
            inPortalThread: true,
            threadId: 'existing-thread-id',
          }),
        );
      });

      it('clears owned loading state when RAG preparation rejects', async () => {
        const preparationError = new Error('Knowledge Base preparation failed');
        const { result } = renderHook(() => useChatStore());

        act(() => {
          useChatStore.setState({ portalThreadId: 'existing-thread-id' });
        });

        vi.spyOn(result.current, 'internal_shouldUseRAG').mockReturnValue(true);
        vi.spyOn(result.current, 'internal_createMessage').mockResolvedValue('new-msg-id');
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('temp-msg-id');
        const toggleMessageLoadingSpy = vi.spyOn(result.current, 'internal_toggleMessageLoading');
        const coreProcessSpy = vi
          .spyOn(result.current, 'internal_coreProcessMessage')
          .mockRejectedValue(preparationError);

        await act(async () => {
          await expect(result.current.sendThreadMessage({ message: 'test with rag' })).rejects.toBe(
            preparationError,
          );
        });

        expect(coreProcessSpy).toHaveBeenCalledWith(
          expect.any(Array),
          'new-msg-id',
          expect.objectContaining({
            inPortalThread: true,
            ragQuery: 'test with rag',
            threadId: 'existing-thread-id',
          }),
        );
        expect(useChatStore.getState()).toMatchObject({
          isCreatingThreadMessage: false,
          threadMessageSendingId: undefined,
        });
        expect(toggleMessageLoadingSpy).toHaveBeenLastCalledWith(false, 'temp-msg-id');
      });

      it('captures and finalizes the next persisted portal send', async () => {
        const { result } = renderHook(() => useChatStore());

        act(() => {
          useChatStore.setState({ portalThreadId: 'existing-thread-id' });
          result.current.armContextExport();
        });

        vi.spyOn(result.current, 'internal_createMessage').mockResolvedValue('new-msg-id');
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('temp-msg-id');
        vi.spyOn(result.current, 'internal_toggleMessageLoading');
        const coreProcessSpy = vi
          .spyOn(result.current, 'internal_coreProcessMessage')
          .mockImplementation(async (_messages, _parentId, params) => {
            expect(params?.contextExportCaptureId).toBe(
              useChatStore.getState().contextExportBatch?.captureId,
            );
            expect(useChatStore.getState().contextExportCaptureStatus).toBe('capturing');
          });

        await act(async () => {
          await result.current.sendThreadMessage({ message: 'captured portal message' });
        });

        const contextExportCaptureId = coreProcessSpy.mock.calls[0][2]?.contextExportCaptureId;
        expect(contextExportCaptureId).toMatch(/^context_/);
        expect(result.current.contextExportCaptureStatus).toBe('ready');
        expect(result.current.contextExportBatch).toMatchObject({
          captureId: contextExportCaptureId,
          status: 'partial',
        });
      });

      it('keeps context export armed when portal message persistence fails', async () => {
        const { result } = renderHook(() => useChatStore());

        act(() => {
          useChatStore.setState({ portalThreadId: 'existing-thread-id' });
          result.current.armContextExport();
        });

        vi.spyOn(result.current, 'internal_createMessage').mockResolvedValue(undefined);
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('temp-msg-id');
        vi.spyOn(result.current, 'internal_toggleMessageLoading');
        const coreProcessSpy = vi.spyOn(result.current, 'internal_coreProcessMessage');

        await act(async () => {
          await result.current.sendThreadMessage({ message: 'failed portal message' });
        });

        expect(coreProcessSpy).not.toHaveBeenCalled();
        expect(result.current.contextExportCaptureStatus).toBe('armed');
        expect(result.current.contextExportBatch).toBeUndefined();
      });

      it('should not auto-summarize title for existing threads', async () => {
        const { result } = renderHook(() => useChatStore());

        act(() => {
          useChatStore.setState({
            portalThreadId: 'existing-thread-id',
          });
        });

        vi.spyOn(result.current, 'internal_createMessage').mockResolvedValue('new-msg-id');
        vi.spyOn(result.current, 'internal_coreProcessMessage').mockResolvedValue();
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('temp-msg-id');
        vi.spyOn(result.current, 'internal_toggleMessageLoading');

        const summaryTitleSpy = vi.spyOn(result.current, 'summaryThreadTitle').mockResolvedValue();

        await act(async () => {
          await result.current.sendThreadMessage({ message: 'follow-up message' });
        });

        expect(summaryTitleSpy).not.toHaveBeenCalled();
      });
    });

    describe('message processing', () => {
      it('should trigger session update', async () => {
        const { result } = renderHook(() => useChatStore());
        const triggerUpdateMock = vi.fn();

        (useSessionStore.getState as Mock).mockReturnValue({
          triggerSessionUpdate: triggerUpdateMock,
        });

        act(() => {
          useChatStore.setState({
            portalThreadId: 'existing-thread-id',
          });
        });

        vi.spyOn(result.current, 'internal_createMessage').mockResolvedValue('new-msg-id');
        vi.spyOn(result.current, 'internal_coreProcessMessage').mockResolvedValue();
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('temp-msg-id');
        vi.spyOn(result.current, 'internal_toggleMessageLoading');

        await act(async () => {
          await result.current.sendThreadMessage({ message: 'test' });
        });

        expect(triggerUpdateMock).toHaveBeenCalledWith('test-session-id');
      });

      it('should pass RAG query if RAG is enabled', async () => {
        const { result } = renderHook(() => useChatStore());

        act(() => {
          useChatStore.setState({
            portalThreadId: 'existing-thread-id',
          });
        });

        vi.spyOn(result.current, 'internal_shouldUseRAG').mockReturnValue(true);
        vi.spyOn(result.current, 'internal_createMessage').mockResolvedValue('new-msg-id');
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('temp-msg-id');
        vi.spyOn(result.current, 'internal_toggleMessageLoading');

        const coreProcessSpy = vi
          .spyOn(result.current, 'internal_coreProcessMessage')
          .mockResolvedValue();

        await act(async () => {
          await result.current.sendThreadMessage({ message: 'test with rag' });
        });

        expect(coreProcessSpy).toHaveBeenCalledWith(
          expect.any(Array),
          'new-msg-id',
          expect.objectContaining({
            inPortalThread: true,
            ragQuery: 'test with rag',
            threadId: 'existing-thread-id',
          }),
        );
      });
    });
  });

  describe('resendThreadMessage', () => {
    it('should resend message in thread context', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          portalThreadId: 'thread-id',
        });
      });

      const resendSpy = vi.spyOn(result.current, 'internal_resendMessage').mockResolvedValue();

      await act(async () => {
        await result.current.resendThreadMessage('message-id');
      });

      expect(resendSpy).toHaveBeenCalledWith(
        'message-id',
        expect.objectContaining({
          inPortalThread: true,
          messages: expect.any(Array),
          threadId: 'thread-id',
        }),
      );
    });
  });

  describe('delAndResendThreadMessage', () => {
    it('should use the transactional resend path', async () => {
      const { result } = renderHook(() => useChatStore());

      const resendSpy = vi.spyOn(result.current, 'resendThreadMessage').mockResolvedValue();

      await act(async () => {
        await result.current.delAndResendThreadMessage('message-id');
      });

      expect(resendSpy).toHaveBeenCalledWith('message-id');
    });

    it('does not delegate resend during an active owner mismatch', async () => {
      hasActiveUserStateOwnerMismatch = true;
      const { result } = renderHook(() => useChatStore());
      const resendSpy = vi.spyOn(result.current, 'resendThreadMessage');

      await result.current.delAndResendThreadMessage('message-id');

      expect(resendSpy).not.toHaveBeenCalled();
    });
  });

  describe('internal_updateThreadTitleInSummary', () => {
    it('should dispatch thread update', () => {
      const { result } = renderHook(() => useChatStore());

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchThread');

      act(() => {
        useChatStore.setState({
          activeTopicId: 'test-topic-id',
          threadMaps: {
            'test-topic-id': [
              {
                createdAt: new Date(),
                id: 'thread-id',
                lastActiveAt: new Date(),
                sourceMessageId: 'msg-1',
                status: ThreadStatus.Active,
                title: 'Old Title',
                topicId: 'test-topic-id',
                type: ThreadType.Continuation,
                updatedAt: new Date(),
                userId: 'user-1',
              },
            ],
          },
        });
      });

      act(() => {
        result.current.internal_updateThreadTitleInSummary('thread-id', 'New Title');
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        { id: 'thread-id', type: 'updateThread', value: { title: 'New Title' } },
        'updateThreadTitleInSummary',
      );
    });
  });

  describe('internal_updateThreadLoading', () => {
    it('should add thread id to loading list', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_updateThreadLoading('thread-id', true);
      });

      expect(result.current.threadLoadingIds).toContain('thread-id');
    });

    it('should remove thread id from loading list', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ threadLoadingIds: ['thread-id'] });
      });

      act(() => {
        result.current.internal_updateThreadLoading('thread-id', false);
      });

      expect(result.current.threadLoadingIds).not.toContain('thread-id');
    });

    it('keeps loading ids deduplicated', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_updateThreadLoading('thread-id', true);
        result.current.internal_updateThreadLoading('thread-id', true);
      });

      expect(result.current.threadLoadingIds).toEqual(['thread-id']);
    });
  });

  describe('internal_updateThread', () => {
    it('should update thread locally and on server', async () => {
      const { result } = renderHook(() => useChatStore());

      (threadService.updateThread as Mock).mockResolvedValue(undefined);

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchThread');
      const refreshSpy = vi.spyOn(result.current, 'refreshThreads').mockResolvedValue();
      const loadingSpy = vi.spyOn(result.current, 'internal_updateThreadLoading');

      await act(async () => {
        await result.current.internal_updateThread('thread-id', { title: 'Updated Title' });
      });

      expect(dispatchSpy).toHaveBeenCalledWith({
        id: 'thread-id',
        type: 'updateThread',
        value: { title: 'Updated Title' },
      });
      expect(threadService.updateThread).toHaveBeenCalledWith('thread-id', {
        title: 'Updated Title',
      });
      expect(refreshSpy).toHaveBeenCalled();
      expect(loadingSpy).toHaveBeenCalledWith('thread-id', true);
      expect(loadingSpy).toHaveBeenCalledWith('thread-id', false);
    });

    it('keeps a sibling loading marker when an older update finishes', async () => {
      const firstUpdate = createDeferred<void>();
      const secondUpdate = createDeferred<void>();
      const threadId = 'overlapping-thread-update';
      const { result } = renderHook(() => useChatStore());
      (threadService.updateThread as Mock)
        .mockReturnValueOnce(firstUpdate.promise)
        .mockReturnValueOnce(secondUpdate.promise);
      vi.spyOn(result.current, 'refreshThreads').mockResolvedValue(undefined);

      const firstPromise = result.current.internal_updateThread(threadId, { title: 'First' });
      const secondPromise = result.current.internal_updateThread(threadId, { title: 'Second' });

      expect(useChatStore.getState().threadLoadingIds).toEqual([threadId]);

      firstUpdate.resolve();
      await firstPromise;
      expect(useChatStore.getState().threadLoadingIds).toEqual([threadId]);

      secondUpdate.resolve();
      await secondPromise;
      expect(useChatStore.getState().threadLoadingIds).not.toContain(threadId);
    });

    it('does not let an invalidated finalizer clear a newer same-thread update', async () => {
      const staleUpdate = createDeferred<void>();
      const currentUpdate = createDeferred<void>();
      const threadId = 'reset-overlap-thread';
      const { result } = renderHook(() => useChatStore());
      (threadService.updateThread as Mock)
        .mockReturnValueOnce(staleUpdate.promise)
        .mockReturnValueOnce(currentUpdate.promise);
      vi.spyOn(result.current, 'refreshThreads').mockResolvedValue(undefined);

      const stalePromise = result.current.internal_updateThread(threadId, { title: 'Stale' });
      act(() => {
        result.current.internal_invalidateConversation();
      });
      const currentPromise = result.current.internal_updateThread(threadId, { title: 'Current' });

      staleUpdate.resolve();
      await stalePromise;
      expect(useChatStore.getState().threadLoadingIds).toEqual([threadId]);

      currentUpdate.resolve();
      await currentPromise;
      expect(useChatStore.getState().threadLoadingIds).not.toContain(threadId);
    });

    it('clears current loading before a stale same-thread update settles', async () => {
      const staleUpdate = createDeferred<void>();
      const currentUpdate = createDeferred<void>();
      const threadId = 'reverse-reset-overlap-thread';
      const { result } = renderHook(() => useChatStore());
      (threadService.updateThread as Mock)
        .mockReturnValueOnce(staleUpdate.promise)
        .mockReturnValueOnce(currentUpdate.promise);
      vi.spyOn(result.current, 'refreshThreads').mockResolvedValue(undefined);

      const stalePromise = result.current.internal_updateThread(threadId, { title: 'Stale' });
      act(() => {
        result.current.internal_invalidateConversation();
      });
      const currentPromise = result.current.internal_updateThread(threadId, { title: 'Current' });

      currentUpdate.resolve();
      await currentPromise;
      expect(useChatStore.getState().threadLoadingIds).not.toContain(threadId);

      staleUpdate.resolve();
      await stalePromise;
      expect(useChatStore.getState().threadLoadingIds).not.toContain(threadId);
    });

    it('releases loading after rejection even when the active topic changed', async () => {
      const rejectedUpdate = createDeferred<void>();
      const threadId = 'navigated-rejected-thread';
      const { result } = renderHook(() => useChatStore());
      (threadService.updateThread as Mock).mockReturnValueOnce(rejectedUpdate.promise);

      const updatePromise = result.current.internal_updateThread(threadId, { title: 'Rejected' });
      act(() => {
        useChatStore.setState({ activeTopicId: 'other-topic' });
      });
      rejectedUpdate.reject(new Error('thread update failed'));

      await expect(updatePromise).rejects.toThrow('thread update failed');
      expect(useChatStore.getState().threadLoadingIds).not.toContain(threadId);
    });
  });

  describe('internal_dispatchThread', () => {
    it('should update threadMaps with reducer result', () => {
      const { result } = renderHook(() => useChatStore());

      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: 'thread-id',
        lastActiveAt: new Date(),
        sourceMessageId: 'msg-1',
        status: ThreadStatus.Active,
        title: 'Old Title',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'user-1',
      };

      act(() => {
        useChatStore.setState({
          activeTopicId: 'test-topic-id',
          threadMaps: {
            'test-topic-id': [mockThread],
          },
        });
      });

      act(() => {
        result.current.internal_dispatchThread({
          id: 'thread-id',
          type: 'updateThread',
          value: { title: 'New Title' },
        });
      });

      const updatedThread = result.current.threadMaps['test-topic-id']?.find(
        (t) => t.id === 'thread-id',
      );
      expect(updatedThread?.title).toBe('New Title');
    });

    it('should not update if result is the same', () => {
      const { result } = renderHook(() => useChatStore());

      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: 'thread-id',
        lastActiveAt: new Date(),
        sourceMessageId: 'msg-1',
        status: ThreadStatus.Active,
        title: 'Title',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'user-1',
      };

      act(() => {
        useChatStore.setState({
          activeTopicId: 'test-topic-id',
          threadMaps: {
            'test-topic-id': [mockThread],
          },
        });
      });

      const mapsBefore = result.current.threadMaps;

      // Update with non-existent thread id - should not change anything
      act(() => {
        result.current.internal_dispatchThread({
          id: 'non-existent-thread',
          type: 'updateThread',
          value: { title: 'New Title' },
        });
      });

      // Maps should remain the same reference due to isEqual check
      expect(result.current.threadMaps).toEqual(mapsBefore);
    });
  });
});
