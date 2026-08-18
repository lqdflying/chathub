import { UIChatMessage } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mutate } from 'swr';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
import { chatService } from '@/services/chat';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useSessionStore } from '@/store/session';
import { systemAgentSelectors } from '@/store/user/selectors';
import { LobeSessionType } from '@/types/session';
import { ChatTopic } from '@/types/topic';

import { useChatStore } from '../../store';

vi.mock('@/helpers/durableConversationGeneration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/helpers/durableConversationGeneration')>()),
  isClientDurableConversationGenerationEnabled: vi.fn(() => false),
}));
vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
let currentUserScope = 'local';
let hasActiveUserStateOwnerMismatch = false;
vi.mock('@/store/user', () => {
  const userState = {
    get isUserStateInit() {
      return true;
    },
    ownershipInvalidationGeneration: 0,
    get userStateScope() {
      return currentUserScope;
    },
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
    currentUserScope: () => currentUserScope,
    hasActiveUserStateOwnerMismatch: () => hasActiveUserStateOwnerMismatch,
  },
  systemAgentSelectors: {
    topic: vi.fn(() => ({})),
  },
}));
// Mock topicService 和 messageService
vi.mock('@/services/topic', () => ({
  topicService: {
    batchRemoveTopics: vi.fn(),
    cloneTopic: vi.fn(),
    createTopic: vi.fn(),
    getTopics: vi.fn(),
    removeAllTopic: vi.fn(),
    removeTopic: vi.fn(),
    removeTopics: vi.fn(),
    searchTopics: vi.fn(),
    updateTopic: vi.fn(),
    updateTopicFavorite: vi.fn(),
    updateTopicTitle: vi.fn(),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    getConversationVersion: vi.fn(() => Promise.resolve(7)),
    getMessages: vi.fn(),
    removeMessages: vi.fn(),
    removeMessagesByAssistant: vi.fn(),
  },
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    destroy: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('i18next', () => ({
  t: vi.fn((key, params) => (params.title ? key + '_' + params.title : key)),
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
  // Setup initial state and mocks before each test
  vi.clearAllMocks();
  currentUserScope = 'local';
  hasActiveUserStateOwnerMismatch = false;
  useChatStore.setState(
    {
      activeId: undefined,
      activeTopicId: undefined,
      conversationClearGeneration: 0,
      creatingTopic: false,
      creatingTopicId: undefined,
      searchTopics: [],
      topicLoadingIds: [],
      topicMaps: {},
      topicTitleSummaryOperations: {},
      topicsInit: false,
    },
    false,
  );
  useSessionStore.setState(
    {
      activeId: 'inbox',
      defaultSessions: [],
      isSessionsFirstFetchFinished: false,
      pinnedSessions: [],
      sessions: [],
    },
    false,
  );
});

afterEach(() => {
  // Cleanup mocks after each test
  vi.restoreAllMocks();
});

describe('topic action', () => {
  describe('openNewTopicOrSaveTopic', () => {
    it('should call switchTopic if activeTopicId exists', async () => {
      const { result } = renderHook(() => useChatStore());
      await act(async () => {
        useChatStore.setState({ activeTopicId: 'existing-topic-id' });
      });

      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        result.current.openNewTopicOrSaveTopic();
      });

      expect(switchTopicSpy).toHaveBeenCalled();
    });

    it('should call saveToTopic if activeTopicId does not exist', async () => {
      const { result } = renderHook(() => useChatStore());
      await act(async () => {
        useChatStore.setState({ activeTopicId: '' });
      });

      const saveToTopicSpy = vi.spyOn(result.current, 'saveToTopic');

      await act(async () => {
        await result.current.openNewTopicOrSaveTopic();
      });

      expect(saveToTopicSpy).toHaveBeenCalled();
    });

    it('does not delegate topic persistence during an active owner mismatch', async () => {
      hasActiveUserStateOwnerMismatch = true;
      useChatStore.setState({ activeTopicId: '' });
      const { result } = renderHook(() => useChatStore());
      const saveToTopicSpy = vi.spyOn(result.current, 'saveToTopic');
      const refreshMessagesSpy = vi.spyOn(result.current, 'refreshMessages');

      await result.current.openNewTopicOrSaveTopic();

      expect(saveToTopicSpy).not.toHaveBeenCalled();
      expect(refreshMessagesSpy).not.toHaveBeenCalled();
    });
  });
  describe('saveToTopic', () => {
    it('should not create a topic if there are no messages', async () => {
      const { result } = renderHook(() => useChatStore());
      act(() => {
        useChatStore.setState({
          activeId: 'session',
          messagesMap: {
            [messageMapKey('session')]: [],
          },
        });
      });

      const createTopicSpy = vi.spyOn(topicService, 'createTopic');

      const topicId = await result.current.saveToTopic();

      expect(createTopicSpy).not.toHaveBeenCalled();
      expect(topicId).toBeUndefined();
    });

    it('should create a topic and bind messages to it', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [{ id: 'message1' }, { id: 'message2' }] as UIChatMessage[];
      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          messagesMap: {
            [messageMapKey('session-id')]: messages,
          },
        });
      });

      const createTopicSpy = vi
        .spyOn(topicService, 'createTopic')
        .mockResolvedValue('new-topic-id');

      const topicId = await result.current.saveToTopic();

      expect(createTopicSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: messages.map((m) => m.id),
          sessionId: 'session-id',
        }),
        undefined,
      );
      expect(topicId).toEqual('new-topic-id');
    });

    it('should reset supervisor todos after saving to topic for group sessions', async () => {
      const { result } = renderHook(() => useChatStore());
      const groupId = 'group-session';
      const todoKey = messageMapKey(groupId, null);
      const messages = [{ id: 'group-message-1' }] as UIChatMessage[];

      await act(async () => {
        useChatStore.setState({
          activeId: groupId,
          activeSessionType: 'group',
          messagesMap: {
            [messageMapKey(groupId)]: messages,
          },
          supervisorTodos: {
            [todoKey]: [{ id: 'todo-1' } as any],
          },
        });
      });

      vi.spyOn(topicService, 'createTopic').mockResolvedValue('group-topic-id');
      vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);
      const summarySpy = vi.spyOn(result.current, 'summaryTopicTitle').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.saveToTopic();
      });

      expect(summarySpy).toHaveBeenCalled();
      expect(useChatStore.getState().supervisorTodos[todoKey]).toEqual([]);
    });
  });
  describe('refreshTopic', () => {
    beforeEach(() => {
      vi.mock('swr', async () => {
        const actual = await vi.importActual('swr');
        return {
          ...(actual as any),
          mutate: vi.fn(),
        };
      });
    });
    afterEach(() => {
      // 在每个测试用例开始前恢复到实际的 SWR 实现
      vi.resetAllMocks();
    });

    it('should call mutate to refresh topics', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeId = 'test-session-id';

      act(() => {
        useChatStore.setState({ activeId });
      });
      // Mock the mutate function to resolve immediately

      await act(async () => {
        await result.current.refreshTopic();
      });

      // Check if mutate has been called with the active session ID
      expect(mutate).toHaveBeenCalledWith([
        'SWR_USE_FETCH_TOPIC',
        'local',
        activeId,
        ['account-cache-epoch', 0],
      ]);
    });

    it('should handle errors during refreshing topics', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeId = 'test-session-id';

      act(() => {
        useChatStore.setState({ activeId });
      });
      // Mock the mutate function to throw an error
      // 设置模拟错误
      (mutate as Mock).mockImplementation(() => {
        throw new Error('Mutate error');
      });

      await act(async () => {
        await expect(result.current.refreshTopic()).rejects.toThrow('Mutate error');
      });

      // 确保恢复 mutate 的模拟，以免影响其他测试
      (mutate as Mock).mockReset();
    });

    // Additional tests for refreshTopic can be added here...
  });
  describe('favoriteTopic', () => {
    it('should update the favorite state of a topic and refresh topics', async () => {
      useChatStore.setState({ activeId: 'test-session-id' });
      const { result } = renderHook(() => useChatStore());
      const topicId = 'topic-id';
      const favState = true;

      const updateFavoriteSpy = vi
        .spyOn(topicService, 'updateTopic')
        .mockResolvedValue({ success: 1 });

      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        await result.current.favoriteTopic(topicId, favState);
      });

      expect(updateFavoriteSpy).toHaveBeenCalledWith(topicId, { favorite: favState });
      expect(refreshTopicSpy).toHaveBeenCalled();
    });
  });
  describe('useFetchTopics', () => {
    it('should fetch topics for a given session id', async () => {
      const sessionId = 'test-session-id';
      const topics = [{ id: 'topic-id', title: 'Test Topic' }];

      // Mock the topicService.getTopics to resolve with topics array
      (topicService.getTopics as Mock).mockResolvedValue(topics);

      // Use the hook with the session id
      const { result } = renderHook(() => useChatStore().useFetchTopics(true, sessionId));

      // Wait for the hook to resolve and update the state
      await waitFor(() => {
        expect(result.current.data).toEqual([
          expect.objectContaining({ id: 'topic-id', title: 'Test Topic' }),
        ]);
      });
      expect(useChatStore.getState().topicsInit).toBeTruthy();
      expect(useChatStore.getState().topicMaps).toEqual({
        [sessionId]: [expect.objectContaining({ id: 'topic-id', title: 'Test Topic' })],
      });
    });
  });
  describe('useSearchTopics', () => {
    it('should search topics with the given keywords', async () => {
      const keywords = 'search-term';
      const searchResults = [{ id: 'searched-topic-id', title: 'Searched Topic' }];

      // Mock the topicService.searchTopics to resolve with search results
      (topicService.searchTopics as Mock).mockResolvedValue(searchResults);

      // Use the hook with the keywords
      const { result } = renderHook(() => useChatStore().useSearchTopics(keywords));

      // Wait for the hook to resolve and update the state
      await waitFor(() => {
        expect(result.current.data).toEqual([
          expect.objectContaining({ id: 'searched-topic-id', title: 'Searched Topic' }),
        ]);
      });
    });
  });
  describe('updateTopicTitle', () => {
    it('should call topicService.updateTitle with correct parameters and refresh the topic', async () => {
      useChatStore.setState({ activeId: 'test-session-id' });
      const topicId = 'topic-id';
      const newTitle = 'Updated Topic Title';
      // Mock the topicService.updateTitle to resolve immediately

      const spyOn = vi.spyOn(topicService, 'updateTopic');

      const { result } = renderHook(() => useChatStore());

      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      // Call the action with the topicId and newTitle
      await act(async () => {
        await result.current.updateTopicTitle(topicId, newTitle);
      });

      // Verify that the topicService.updateTitle was called with correct parameters
      expect(spyOn).toHaveBeenCalledWith(
        topicId,
        {
          title: 'Updated Topic Title',
        },
        {
          touchActivity: true,
        },
      );

      // Verify that the refreshTopic was called to update the state
      expect(refreshTopicSpy).toHaveBeenCalled();
    });

    it('keeps one loading marker until overlapping title updates settle', async () => {
      const firstUpdate = createDeferred<void>();
      const secondUpdate = createDeferred<void>();
      const topicId = 'overlapping-title-topic';
      const { result } = renderHook(() => useChatStore());
      useChatStore.setState({ activeId: 'test-session-id' });
      vi.spyOn(topicService, 'updateTopic')
        .mockReturnValueOnce(firstUpdate.promise)
        .mockReturnValueOnce(secondUpdate.promise);
      vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);

      const firstPromise = result.current.updateTopicTitle(topicId, 'First Title');
      const secondPromise = result.current.updateTopicTitle(topicId, 'Second Title');

      expect(useChatStore.getState().topicLoadingIds).toEqual([topicId]);

      firstUpdate.resolve();
      await firstPromise;
      expect(useChatStore.getState().topicLoadingIds).toEqual([topicId]);

      secondUpdate.resolve();
      await secondPromise;
      expect(useChatStore.getState().topicLoadingIds).not.toContain(topicId);
    });

    it('releases its loading marker when title persistence rejects', async () => {
      const topicId = 'rejected-title-topic';
      const persistenceError = new Error('title update failed');
      const { result } = renderHook(() => useChatStore());
      useChatStore.setState({ activeId: 'test-session-id' });
      vi.spyOn(topicService, 'updateTopic').mockRejectedValueOnce(persistenceError);

      await expect(result.current.updateTopicTitle(topicId, 'Rejected Title')).rejects.toThrow(
        persistenceError,
      );

      expect(useChatStore.getState().topicLoadingIds).not.toContain(topicId);
    });
  });
  describe('switchTopic', () => {
    it('should update activeTopicId and call refreshMessages', async () => {
      const topicId = 'topic-id';
      const { result } = renderHook(() => useChatStore());

      const refreshMessagesSpy = vi.spyOn(result.current, 'refreshMessages');
      // Call the switchTopic action with the topicId
      await act(async () => {
        await result.current.switchTopic(topicId);
      });

      // Verify that the activeTopicId has been updated
      expect(useChatStore.getState().activeTopicId).toBe(topicId);

      // Verify that the refreshMessages was called to update the messages
      expect(refreshMessagesSpy).toHaveBeenCalled();
    });

    it('should reset supervisor todos and cancel supervisor decision for group sessions', async () => {
      const { result } = renderHook(() => useChatStore());
      const groupId = 'group-1';
      const nextTopicId = 'topic-2';
      const expectedKey = messageMapKey(groupId, nextTopicId);

      await act(async () => {
        useChatStore.setState({
          activeId: groupId,
          activeSessionType: 'group',
          supervisorTodos: {
            [messageMapKey(groupId, null)]: [{ id: 'todo' } as any],
          },
        });
      });

      const cancelSpy = vi.spyOn(result.current, 'internal_cancelSupervisorDecision');
      vi.spyOn(result.current, 'refreshMessages').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.switchTopic(nextTopicId);
      });

      expect(cancelSpy).toHaveBeenCalledWith(groupId);
      expect(useChatStore.getState().supervisorTodos[expectedKey]).toEqual([]);
    });

    it('should detect group sessions from session store when type is not cached', async () => {
      const { result } = renderHook(() => useChatStore());
      const groupId = 'group-from-session';
      const newTopicId = 'topic-session';
      const expectedKey = messageMapKey(groupId, newTopicId);

      await act(async () => {
        useChatStore.setState({
          activeId: groupId,
          activeSessionType: undefined,
          supervisorTodos: {},
        });
      });

      useSessionStore.setState({
        activeId: groupId,
        sessions: [
          {
            createdAt: new Date(0),
            id: groupId,
            meta: {},
            type: LobeSessionType.Group,
            updatedAt: new Date(0),
          } as any,
        ],
      });

      const cancelSpy = vi.spyOn(result.current, 'internal_cancelSupervisorDecision');
      vi.spyOn(result.current, 'refreshMessages').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.switchTopic(newTopicId);
      });

      expect(cancelSpy).toHaveBeenCalledWith(groupId);
      expect(useChatStore.getState().supervisorTodos[expectedKey]).toEqual([]);
    });
  });
  describe('removeSessionTopics', () => {
    it('should remove all topics from the current session and refresh the topic list', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeId = 'test-session-id';
      await act(async () => {
        useChatStore.setState({ activeId });
      });
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.removeSessionTopics();
      });

      expect(topicService.removeTopics).toHaveBeenCalledWith(activeId);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });
  });
  describe('removeGroupTopics', () => {
    it('should remove all topics for the specified group and refresh state', async () => {
      const { result } = renderHook(() => useChatStore());
      const groupId = 'group-delete';
      const topics = [
        { id: 'topic-1', title: 'Topic 1' } as ChatTopic,
        { id: 'topic-2', title: 'Topic 2' } as ChatTopic,
      ];

      await act(async () => {
        useChatStore.setState({
          activeId: groupId,
          topicMaps: {
            [groupId]: topics,
          },
        });
      });

      const batchRemoveSpy = topicService.batchRemoveTopics as Mock;
      batchRemoveSpy.mockClear();
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeGroupTopics(groupId);
      });

      expect(batchRemoveSpy).toHaveBeenCalledWith(['topic-1', 'topic-2']);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });
  });
  describe('removeAllTopics', () => {
    it('should remove all topics and refresh the topic list', async () => {
      useChatStore.setState({ activeId: 'test-session-id' });
      const { result } = renderHook(() => useChatStore());

      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        await result.current.removeAllTopics();
      });

      expect(topicService.removeAllTopic).toHaveBeenCalled();
      expect(refreshTopicSpy).toHaveBeenCalled();
    });
  });
  describe('removeTopic', () => {
    it('should remove a specific topic and its messages, then refresh the topic list', async () => {
      const topicId = 'topic-1';
      const { result } = renderHook(() => useChatStore());
      const activeId = 'test-session-id';

      await act(async () => {
        useChatStore.setState({ activeId, activeTopicId: topicId });
      });

      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.removeTopic(topicId);
      });

      expect(messageService.removeMessagesByAssistant).toHaveBeenCalledWith(activeId, topicId);
      expect(topicService.removeTopic).toHaveBeenCalledWith(topicId);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });
    it('should remove a specific topic and its messages, then not refresh the topic list', async () => {
      const topicId = 'topic-1';
      const { result } = renderHook(() => useChatStore());
      const activeId = 'test-session-id';

      await act(async () => {
        useChatStore.setState({ activeId });
      });

      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.removeTopic(topicId);
      });

      expect(messageService.removeMessagesByAssistant).toHaveBeenCalledWith(activeId, topicId);
      expect(topicService.removeTopic).toHaveBeenCalledWith(topicId);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).not.toHaveBeenCalled();
    });

    it('finishes explicit deletion after topic selection changes without navigating', async () => {
      const removedMessages = createDeferred<void>();
      const topicId = 'topic-being-removed';
      const activeId = 'test-session-id';
      const { result } = renderHook(() => useChatStore());
      vi.spyOn(messageService, 'removeMessagesByAssistant').mockReturnValue(
        removedMessages.promise,
      );
      vi.spyOn(topicService, 'removeTopic').mockResolvedValue(undefined);
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      act(() => {
        useChatStore.setState({ activeId, activeTopicId: topicId });
      });
      const removalPromise = result.current.removeTopic(topicId);

      await waitFor(() => {
        expect(messageService.removeMessagesByAssistant).toHaveBeenCalledWith(activeId, topicId);
      });

      act(() => {
        useChatStore.setState({ activeTopicId: 'newly-selected-topic' });
      });
      removedMessages.resolve();
      await removalPromise;

      expect(topicService.removeTopic).toHaveBeenCalledWith(topicId);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).not.toHaveBeenCalled();
      expect(useChatStore.getState().activeTopicId).toBe('newly-selected-topic');
    });

    it('finishes explicit deletion after switchTopic invalidates the conversation', async () => {
      const removedMessages = createDeferred<void>();
      const topicId = 'topic-being-removed';
      const activeId = 'test-session-id';
      const { result } = renderHook(() => useChatStore());
      vi.spyOn(messageService, 'removeMessagesByAssistant').mockReturnValue(
        removedMessages.promise,
      );
      vi.spyOn(topicService, 'removeTopic').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'refreshMessages').mockResolvedValue(undefined);

      act(() => {
        useChatStore.setState({ activeId, activeTopicId: topicId });
      });
      const removalPromise = result.current.removeTopic(topicId);

      await waitFor(() => {
        expect(messageService.removeMessagesByAssistant).toHaveBeenCalledWith(activeId, topicId);
      });

      await act(async () => {
        await result.current.switchTopic('newly-selected-topic');
      });
      removedMessages.resolve();
      await removalPromise;

      expect(topicService.removeTopic).toHaveBeenCalledWith(topicId);
      expect(useChatStore.getState().activeTopicId).toBe('newly-selected-topic');
    });
  });
  describe('removeUnstarredTopic', () => {
    it('should remove unstarred topics and refresh the topic list', async () => {
      const { result } = renderHook(() => useChatStore());
      // Set up mock state with unstarred topics
      await act(async () => {
        useChatStore.setState({
          activeId: 'abc',
          topicMaps: {
            abc: [
              { favorite: false, id: 'topic-1' },
              { favorite: true, id: 'topic-2' },
              { favorite: false, id: 'topic-3' },
            ] as ChatTopic[],
          },
        });
      });
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.removeUnstarredTopic();
      });

      expect(topicService.batchRemoveTopics).toHaveBeenCalledWith(['topic-1', 'topic-3']);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });
  });
  describe('updateTopicLoading', () => {
    it('should call update topicLoadingId', async () => {
      const { result } = renderHook(() => useChatStore());
      act(() => {
        useChatStore.setState({ topicLoadingIds: [] });
      });

      expect(result.current.topicLoadingIds).toHaveLength(0);

      // Call the action with the topicId and newTitle
      act(() => {
        result.current.internal_updateTopicLoading('loading-id', true);
      });

      expect(result.current.topicLoadingIds).toEqual(['loading-id']);
    });

    it('keeps loading ids deduplicated', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_updateTopicLoading('loading-id', true);
        result.current.internal_updateTopicLoading('loading-id', true);
      });

      expect(result.current.topicLoadingIds).toEqual(['loading-id']);
    });
  });
  describe('internal_updateTopic', () => {
    it('keeps a sibling loading marker when an older update finishes', async () => {
      const firstUpdate = createDeferred<void>();
      const secondUpdate = createDeferred<void>();
      const topicId = 'overlapping-topic-update';
      const { result } = renderHook(() => useChatStore());
      useChatStore.setState({ activeId: 'test-session-id' });
      vi.spyOn(topicService, 'updateTopic')
        .mockReturnValueOnce(firstUpdate.promise)
        .mockReturnValueOnce(secondUpdate.promise);
      vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);

      const firstPromise = result.current.internal_updateTopic(topicId, { favorite: true });
      const secondPromise = result.current.internal_updateTopic(topicId, { favorite: false });

      expect(useChatStore.getState().topicLoadingIds).toEqual([topicId]);

      firstUpdate.resolve();
      await firstPromise;
      expect(useChatStore.getState().topicLoadingIds).toEqual([topicId]);

      secondUpdate.resolve();
      await secondPromise;
      expect(useChatStore.getState().topicLoadingIds).not.toContain(topicId);
    });

    it('does not let an invalidated finalizer clear a newer same-topic update', async () => {
      const staleUpdate = createDeferred<void>();
      const currentUpdate = createDeferred<void>();
      const topicId = 'reset-overlap-topic';
      const { result } = renderHook(() => useChatStore());
      useChatStore.setState({ activeId: 'test-session-id' });
      vi.spyOn(topicService, 'updateTopic')
        .mockReturnValueOnce(staleUpdate.promise)
        .mockReturnValueOnce(currentUpdate.promise);
      vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);

      const stalePromise = result.current.internal_updateTopic(topicId, { favorite: true });
      act(() => {
        result.current.internal_invalidateConversation();
      });
      const currentPromise = result.current.internal_updateTopic(topicId, { favorite: false });

      staleUpdate.resolve();
      await stalePromise;
      expect(useChatStore.getState().topicLoadingIds).toEqual([topicId]);

      currentUpdate.resolve();
      await currentPromise;
      expect(useChatStore.getState().topicLoadingIds).not.toContain(topicId);
    });

    it('clears current loading before a stale same-topic update settles', async () => {
      const staleUpdate = createDeferred<void>();
      const currentUpdate = createDeferred<void>();
      const topicId = 'reverse-reset-overlap-topic';
      const { result } = renderHook(() => useChatStore());
      useChatStore.setState({ activeId: 'test-session-id' });
      vi.spyOn(topicService, 'updateTopic')
        .mockReturnValueOnce(staleUpdate.promise)
        .mockReturnValueOnce(currentUpdate.promise);
      vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);

      const stalePromise = result.current.internal_updateTopic(topicId, { favorite: true });
      act(() => {
        result.current.internal_invalidateConversation();
      });
      const currentPromise = result.current.internal_updateTopic(topicId, { favorite: false });

      currentUpdate.resolve();
      await currentPromise;
      expect(useChatStore.getState().topicLoadingIds).not.toContain(topicId);

      staleUpdate.resolve();
      await stalePromise;
      expect(useChatStore.getState().topicLoadingIds).not.toContain(topicId);
    });

    it('releases loading after rejection even when the active container changed', async () => {
      const rejectedUpdate = createDeferred<void>();
      const topicId = 'navigated-rejected-topic';
      const { result } = renderHook(() => useChatStore());
      useChatStore.setState({ activeId: 'test-session-id' });
      vi.spyOn(topicService, 'updateTopic').mockReturnValueOnce(rejectedUpdate.promise);

      const updatePromise = result.current.internal_updateTopic(topicId, { favorite: true });
      act(() => {
        useChatStore.setState({ activeId: 'other-session' });
      });
      rejectedUpdate.reject(new Error('update failed'));

      await expect(updatePromise).rejects.toThrow('update failed');
      expect(useChatStore.getState().topicLoadingIds).not.toContain(topicId);
    });
  });
  describe('summaryTopicTitle', () => {
    it('uses a new durable request key for each title summary of the same topic', async () => {
      vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
      vi.mocked(systemAgentSelectors.topic).mockReturnValue({
        model: 'gpt-5-mini',
        provider: 'openai',
      } as any);
      const enqueue = vi.spyOn(conversationGenerationService, 'enqueue').mockImplementation(
        async (input: any) =>
          ({
            id: `cgo-${input.idempotencyKey}`,
            kind: 'topic_title',
            lane: 'lane-title',
            laneGeneration: 1,
            revision: 1,
          }) as any,
      );
      const topicId = 'topic-1';
      const { result } = renderHook(() => useChatStore());
      act(() => {
        useChatStore.setState({
          activeId: 'test',
          attachConversationGeneration: vi.fn(),
          topicMaps: { test: [{ id: topicId, title: 'Test Topic' }] as ChatTopic[] },
        });
      });

      await act(async () => {
        await result.current.summaryTopicTitle(topicId, []);
      });
      await act(async () => {
        await result.current.summaryTopicTitle(topicId, []);
      });

      expect(enqueue).toHaveBeenCalledTimes(2);
      const keys = enqueue.mock.calls.map(([input]) => input.idempotencyKey);
      expect(keys[0]).not.toEqual(keys[1]);
      expect(keys[0]).toContain('topic-title');
      expect(keys[1]).toContain('topic-title');
    });

    it('should auto-summarize the topic title and update it', async () => {
      const topicId = 'topic-1';
      const messages = [{ content: 'Hello', id: 'message-1' }] as UIChatMessage[];
      const topics = [{ id: 'topic-1', title: 'Test Topic' }] as ChatTopic[];
      const { result } = renderHook(() => useChatStore());
      const updateTopicSpy = vi.spyOn(topicService, 'updateTopic').mockResolvedValue(undefined);
      await act(async () => {
        useChatStore.setState({ activeId: 'test', topicMaps: { test: topics } });
      });

      // Mock the `chatService.fetchPresetTaskResult` to simulate the AI response
      vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation(async (params) => {
        if (params) {
          await params.onFinish?.('Summarized Title', { type: 'done' });
        }
      });

      await act(async () => {
        await result.current.summaryTopicTitle(topicId, messages);
      });

      expect(updateTopicSpy).toHaveBeenCalledWith(topicId, {
        title: 'Summarized Title',
      });
      expect(useChatStore.getState().topicLoadingIds).not.toContain(topicId);
      expect(useChatStore.getState().topicMaps.test[0].title).toBe('Summarized Title');
    });

    it('ignores stale title callbacks after an A-to-B-to-A reset', async () => {
      const topicId = 'account-a-topic';
      const messages = [{ content: 'Hello', id: 'account-a-message' }] as UIChatMessage[];
      const { result } = renderHook(() => useChatStore());
      const updateTopicSpy = vi.spyOn(topicService, 'updateTopic').mockResolvedValue(undefined);

      act(() => {
        currentUserScope = 'user:account-a';
        useChatStore.setState({
          activeId: 'account-a-session',
          conversationClearGeneration: 0,
          topicMaps: {
            'account-a-session': [{ id: topicId, title: 'Original Title' }] as ChatTopic[],
          },
        });
      });

      vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation(
        async ({ onLoadingChange, onMessageHandle, onFinish }) => {
          act(() => {
            currentUserScope = 'user:account-b';
            useChatStore.setState({
              activeId: 'account-b-session',
              conversationClearGeneration: 1,
              topicMaps: {},
            });
            currentUserScope = 'user:account-a';
            useChatStore.setState({
              activeId: 'account-a-session',
              topicMaps: {
                'account-a-session': [{ id: topicId, title: 'Newer Title' }] as ChatTopic[],
              },
            });
          });

          await onLoadingChange?.(true);
          await onMessageHandle?.({ text: 'Stale', type: 'text' });
          await onFinish?.('Stale Title', { type: 'done' });
          await onLoadingChange?.(false);
        },
      );

      await act(async () => {
        await result.current.summaryTopicTitle(topicId, messages);
      });

      expect(updateTopicSpy).not.toHaveBeenCalled();
      expect(useChatStore.getState().topicLoadingIds).not.toContain(topicId);
      expect(useChatStore.getState().topicTitleSummaryOperations[topicId]).toBeUndefined();
      expect(useChatStore.getState().topicMaps['account-a-session']?.[0]?.title).toBe(
        'Newer Title',
      );
    });

    it('aborts and cleans its owned placeholder when the conversation is invalidated', async () => {
      const topicId = 'topic-to-abort';
      const { result } = renderHook(() => useChatStore());
      let observedAbortController: AbortController | undefined;

      act(() => {
        useChatStore.setState({
          activeId: 'test-session',
          conversationClearGeneration: 0,
          topicMaps: {
            'test-session': [{ id: topicId, title: 'Original Title' }] as ChatTopic[],
          },
        });
      });

      vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation(
        ({ abortController }) =>
          new Promise((resolve) => {
            observedAbortController = abortController;
            abortController?.signal.addEventListener('abort', () => resolve(undefined), {
              once: true,
            });
          }),
      );

      let summaryPromise!: ReturnType<typeof result.current.summaryTopicTitle>;
      act(() => {
        summaryPromise = result.current.summaryTopicTitle(topicId, []);
      });

      await waitFor(() => {
        expect(observedAbortController).toBeDefined();
        expect(useChatStore.getState().topicLoadingIds).toContain(topicId);
        expect(useChatStore.getState().topicMaps['test-session'][0].title).toBe(LOADING_FLAT);
      });

      act(() => {
        result.current.internal_invalidateConversation();
      });

      await act(async () => {
        await summaryPromise;
      });

      expect(observedAbortController?.signal.aborted).toBe(true);
      expect(useChatStore.getState().topicLoadingIds).not.toContain(topicId);
      expect(useChatStore.getState().topicTitleSummaryOperations).toEqual({});
      expect(useChatStore.getState().topicMaps['test-session'][0].title).toBe('Original Title');
    });

    it('persists the newest overlapping summary after an older write finishes', async () => {
      const topicId = 'overlapping-topic';
      const olderPersistence = createDeferred<void>();
      const { result } = renderHook(() => useChatStore());
      const updateTopicSpy = vi
        .spyOn(topicService, 'updateTopic')
        .mockReturnValueOnce(olderPersistence.promise)
        .mockResolvedValueOnce(undefined);
      let summaryInvocation = 0;

      act(() => {
        useChatStore.setState({
          activeId: 'test-session',
          conversationClearGeneration: 0,
          topicMaps: {
            'test-session': [{ id: topicId, title: 'Original Title' }] as ChatTopic[],
          },
        });
      });

      vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation(async ({ onFinish }) => {
        summaryInvocation += 1;
        await onFinish?.(summaryInvocation === 1 ? 'Older Title' : 'Newest Title', {
          type: 'done',
        });
      });

      let olderSummaryPromise!: ReturnType<typeof result.current.summaryTopicTitle>;
      act(() => {
        olderSummaryPromise = result.current.summaryTopicTitle(topicId, []);
      });

      await waitFor(() => {
        expect(updateTopicSpy).toHaveBeenCalledWith(topicId, { title: 'Older Title' });
      });

      let newerSummaryPromise!: ReturnType<typeof result.current.summaryTopicTitle>;
      act(() => {
        newerSummaryPromise = result.current.summaryTopicTitle(topicId, []);
      });

      await waitFor(() => {
        expect(useChatStore.getState().topicMaps['test-session'][0].title).toBe('Newest Title');
      });
      expect(updateTopicSpy).toHaveBeenCalledTimes(1);

      olderPersistence.resolve();
      await act(async () => {
        await Promise.all([olderSummaryPromise, newerSummaryPromise]);
      });

      expect(updateTopicSpy.mock.calls).toEqual([
        [topicId, { title: 'Older Title' }],
        [topicId, { title: 'Newest Title' }],
      ]);
      expect(useChatStore.getState().topicMaps['test-session'][0].title).toBe('Newest Title');
      expect(useChatStore.getState().topicLoadingIds).not.toContain(topicId);
      expect(useChatStore.getState().topicTitleSummaryOperations).toEqual({});
    });
  });
  describe('createTopic', () => {
    it('does not start topic creation during an active owner mismatch', async () => {
      hasActiveUserStateOwnerMismatch = true;
      useChatStore.setState({
        activeId: 'test-session-id',
        messagesMap: {
          [messageMapKey('test-session-id')]: [{ id: 'message-1' }] as UIChatMessage[],
        },
      });
      const { result } = renderHook(() => useChatStore());
      const createTopicSpy = vi.spyOn(topicService, 'createTopic');

      const topicId = await result.current.createTopic();

      expect(topicId).toBeUndefined();
      expect(createTopicSpy).not.toHaveBeenCalled();
      expect(useChatStore.getState()).toMatchObject({
        creatingTopic: false,
        creatingTopicId: undefined,
        topicLoadingIds: [],
      });
      expect(useChatStore.getState().topicMaps['test-session-id']).toBeUndefined();
    });

    it('should create a new topic and update the store', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeId = 'test-session-id';
      const newTopicId = 'new-topic-id';
      const messages = [{ id: 'message-1' }, { id: 'message-2' }] as UIChatMessage[];

      await act(async () => {
        useChatStore.setState({
          activeId,
          messagesMap: {
            [messageMapKey(activeId)]: messages,
          },
        });
      });

      const createTopicSpy = vi.spyOn(topicService, 'createTopic').mockResolvedValue(newTopicId);
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        const topicId = await result.current.createTopic();
        expect(topicId).toBe(newTopicId);
      });

      expect(createTopicSpy).toHaveBeenCalledWith(
        {
          messages: messages.map((m) => m.id),
          sessionId: activeId,
          title: 'defaultTitle',
        },
        undefined,
      );
      expect(refreshTopicSpy).toHaveBeenCalled();
    });

    it('does not continue topic creation after ownership becomes invalid mid-flight', async () => {
      const createdTopic = createDeferred<string>();
      const activeId = 'test-session-id';
      useChatStore.setState({
        activeId,
        messagesMap: {
          [messageMapKey(activeId)]: [{ id: 'message-1' }] as UIChatMessage[],
        },
      });
      vi.spyOn(topicService, 'createTopic').mockReturnValue(createdTopic.promise);
      const refreshTopic = vi.fn();
      useChatStore.setState({ refreshTopic });

      const creationPromise = useChatStore.getState().createTopic();
      await waitFor(() => {
        expect(topicService.createTopic).toHaveBeenCalled();
      });

      hasActiveUserStateOwnerMismatch = true;
      createdTopic.resolve('stale-topic-id');
      const topicId = await creationPromise;

      expect(topicId).toBeUndefined();
      expect(refreshTopic).not.toHaveBeenCalled();
    });

    it('clears its creation state and optimistic topic after switching sessions', async () => {
      const { result } = renderHook(() => useChatStore());
      const createdTopic = createDeferred<string>();
      const activeId = 'account-a-session';
      const messages = [{ id: 'account-a-message' }] as UIChatMessage[];

      act(() => {
        currentUserScope = 'user:account-a';
        useChatStore.setState({
          activeId,
          conversationClearGeneration: 0,
          messagesMap: {
            [messageMapKey(activeId)]: messages,
          },
        });
      });

      vi.spyOn(topicService, 'createTopic').mockReturnValue(createdTopic.promise);
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      let createTopicPromise!: ReturnType<typeof result.current.createTopic>;
      act(() => {
        createTopicPromise = result.current.createTopic();
      });

      await waitFor(() => {
        expect(topicService.createTopic).toHaveBeenCalled();
      });

      const creatingTopicId = useChatStore.getState().creatingTopicId;
      const temporaryTopicId = useChatStore.getState().topicMaps[activeId]?.[0]?.id;
      expect(creatingTopicId).toMatch(/^topic-create-/);
      expect(temporaryTopicId).toBeDefined();
      expect(useChatStore.getState().topicLoadingIds).toContain(temporaryTopicId);

      act(() => {
        useChatStore.setState({ activeId: 'account-a-other-session' });
      });
      createdTopic.resolve('stale-account-a-topic');

      let topicId!: Awaited<typeof createTopicPromise>;
      await act(async () => {
        topicId = await createTopicPromise;
      });

      expect(topicId).toBeUndefined();
      expect(refreshTopicSpy).not.toHaveBeenCalled();
      expect(useChatStore.getState().creatingTopic).toBe(false);
      expect(useChatStore.getState().creatingTopicId).toBeUndefined();
      expect(useChatStore.getState().topicLoadingIds).not.toContain(temporaryTopicId);
      expect(useChatStore.getState().topicMaps[activeId]).toEqual([]);
    });

    it('should cancel stale topic creation without clearing newer creation state', async () => {
      const { result } = renderHook(() => useChatStore());
      const createdTopic = createDeferred<string>();
      const activeId = 'account-a-session';
      const messages = [{ id: 'account-a-message' }] as UIChatMessage[];

      act(() => {
        currentUserScope = 'user:account-a';
        useChatStore.setState({
          activeId,
          conversationClearGeneration: 0,
          messagesMap: {
            [messageMapKey(activeId)]: messages,
          },
        });
      });

      vi.spyOn(topicService, 'createTopic').mockReturnValue(createdTopic.promise);
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      let createTopicPromise!: ReturnType<typeof result.current.createTopic>;
      act(() => {
        createTopicPromise = result.current.createTopic();
      });

      await waitFor(() => {
        expect(topicService.createTopic).toHaveBeenCalled();
      });

      act(() => {
        currentUserScope = 'user:account-b';
        useChatStore.setState({
          activeId: 'account-b-session',
          conversationClearGeneration: 1,
          creatingTopic: true,
          creatingTopicId: 'topic-create-account-b',
          topicLoadingIds: ['account-b-topic'],
        });
        currentUserScope = 'user:account-a';
        useChatStore.setState({
          activeId: 'account-a-returned-session',
        });
      });
      createdTopic.resolve('stale-account-a-topic');

      let topicId!: Awaited<typeof createTopicPromise>;
      await act(async () => {
        topicId = await createTopicPromise;
      });

      expect(topicId).toBeUndefined();
      expect(refreshTopicSpy).not.toHaveBeenCalled();
      expect(useChatStore.getState().creatingTopic).toBe(true);
      expect(useChatStore.getState().creatingTopicId).toBe('topic-create-account-b');
      expect(useChatStore.getState().topicLoadingIds).toEqual(['account-b-topic']);
      expect(useChatStore.getState().topicMaps[activeId]).toEqual([]);
    });
  });
  describe('duplicateTopic', () => {
    it('should duplicate a topic and switch to the new topic', async () => {
      const { result } = renderHook(() => useChatStore());
      const topicId = 'topic-1';
      const newTopicId = 'new-topic-id';
      const topics = [{ id: topicId, title: 'Original Topic' }] as ChatTopic[];

      await act(async () => {
        useChatStore.setState({ activeId: 'abc', topicMaps: { abc: topics } });
      });

      const cloneTopicSpy = vi.spyOn(topicService, 'cloneTopic').mockResolvedValue(newTopicId);
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.duplicateTopic(topicId);
      });

      expect(cloneTopicSpy).toHaveBeenCalledWith(topicId, 'duplicateTitle_Original Topic', {
        expectedConversationVersion: 7,
      });
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalledWith(newTopicId);
    });

    it('should not refresh or navigate when duplication finishes after a reset', async () => {
      const { result } = renderHook(() => useChatStore());
      const clonedTopic = createDeferred<string>();
      const topicId = 'account-a-topic';
      const topics = [{ id: topicId, title: 'Account A Topic' }] as ChatTopic[];

      act(() => {
        currentUserScope = 'user:account-a';
        useChatStore.setState({
          activeId: 'account-a-session',
          conversationClearGeneration: 0,
          topicMaps: { 'account-a-session': topics },
        });
      });

      vi.spyOn(topicService, 'cloneTopic').mockReturnValue(clonedTopic.promise);
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      let duplicatePromise!: ReturnType<typeof result.current.duplicateTopic>;
      act(() => {
        duplicatePromise = result.current.duplicateTopic(topicId);
      });

      await waitFor(() => {
        expect(topicService.cloneTopic).toHaveBeenCalled();
      });

      act(() => {
        currentUserScope = 'user:account-b';
        useChatStore.setState({
          activeId: 'account-b-session',
          conversationClearGeneration: 1,
          topicMaps: { 'account-b-session': [{ id: 'account-b-topic' }] as ChatTopic[] },
        });
        currentUserScope = 'user:account-a';
        useChatStore.setState({
          activeId: 'account-a-returned-session',
        });
      });
      clonedTopic.resolve('stale-account-a-clone');

      await act(async () => {
        await duplicatePromise;
      });

      expect(refreshTopicSpy).not.toHaveBeenCalled();
      expect(switchTopicSpy).not.toHaveBeenCalled();
    });
  });
  describe('autoRenameTopicTitle', () => {
    it('should auto-rename the topic title based on the messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const topicId = 'topic-1';
      const activeId = 'test-session-id';
      const messages = [{ content: 'Hello', id: 'message-1' }] as UIChatMessage[];

      await act(async () => {
        useChatStore.setState({ activeId });
      });

      const getMessagesSpy = vi.spyOn(messageService, 'getMessages').mockResolvedValue(messages);
      const summaryTopicTitleSpy = vi.spyOn(result.current, 'summaryTopicTitle');

      await act(async () => {
        await result.current.autoRenameTopicTitle(topicId);
      });

      expect(getMessagesSpy).toHaveBeenCalledWith(activeId, topicId);
      expect(summaryTopicTitleSpy).toHaveBeenCalledWith(topicId, messages);
    });
  });
});
