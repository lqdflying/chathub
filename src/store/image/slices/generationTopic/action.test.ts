import { act, renderHook, waitFor } from '@testing-library/react';
import { mutate } from 'swr';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { chatService } from '@/services/chat';
import { generationTopicService } from '@/services/generationTopic';
import { useImageStore } from '@/store/image';
import { useUserStore } from '@/store/user';
import { ImageGenerationTopic } from '@/types/generation';

const mockedUserState = vi.hoisted(() => ({
  authUserId: 'test-user',
  isLoaded: true,
  isSignedIn: true,
  isUserStateInit: true,
  ownerMismatch: false,
  ownershipInvalidationGeneration: 0,
  scope: 'user:test-user',
  user: { id: 'test-user' },
  userStateScope: 'user:test-user',
}));

// Mock services and dependencies
vi.mock('@/services/generationTopic', () => ({
  generationTopicService: {
    createTopic: vi.fn(),
    updateTopic: vi.fn(),
    deleteTopic: vi.fn(),
    getAllGenerationTopics: vi.fn(),
    housekeep: vi.fn(),
    previewHousekeeping: vi.fn(),
    updateTopicCover: vi.fn(),
  },
}));

vi.mock('@/services/chat', () => ({
  chatService: {
    fetchPresetTaskResult: vi.fn(),
  },
}));

vi.mock('@/store/user', () => {
  const useUserStore = (<Value>(selector: (state: typeof mockedUserState) => Value) =>
    selector(mockedUserState)) as {
    <Value>(selector: (state: typeof mockedUserState) => Value): Value;
    getState: () => typeof mockedUserState;
  };
  useUserStore.getState = () => mockedUserState;

  return { useUserStore };
});

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    currentUserScope: (state: typeof mockedUserState) => state.scope,
    hasActiveUserStateOwnerMismatch: (state: typeof mockedUserState) => state.ownerMismatch,
  },
  systemAgentSelectors: {
    generationTopic: vi.fn().mockReturnValue({
      model: 'gpt-4',
      provider: 'openai',
    }),
  },
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
  mockedUserState.ownerMismatch = false;
  mockedUserState.ownershipInvalidationGeneration = 0;
  mockedUserState.scope = 'user:test-user';
  mockedUserState.userStateScope = 'user:test-user';
  useImageStore.setState({
    generationTopics: [],
    activeGenerationTopicId: null,
    loadingGenerationTopicIds: [],
    scopeGeneration: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GenerationTopicAction', () => {
  describe('createGenerationTopic', () => {
    it('should create a new topic and auto-generate title from prompts', async () => {
      const { result } = renderHook(() => useImageStore());
      const newTopicId = 'gt_new_topic';
      const prompts = ['A beautiful sunset over mountains'];

      vi.mocked(generationTopicService.createTopic).mockResolvedValue(newTopicId);
      vi.mocked(generationTopicService.getAllGenerationTopics).mockResolvedValue([
        {
          id: newTopicId,
          title: 'Beautiful Sunset',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as ImageGenerationTopic[]);

      const createTopicSpy = vi.spyOn(result.current, 'internal_createGenerationTopic');
      const refreshTopicsSpy = vi.spyOn(result.current, 'refreshGenerationTopics');
      const summaryTopicTitleSpy = vi.spyOn(result.current, 'summaryGenerationTopicTitle');

      let createdTopicId;
      await act(async () => {
        createdTopicId = await result.current.createGenerationTopic(prompts);
      });

      expect(createdTopicId).toBe(newTopicId);
      expect(generationTopicService.createTopic).toHaveBeenCalled();
      expect(refreshTopicsSpy.mock.calls[0][0]).toBe(createTopicSpy.mock.calls[0][0]);
      expect(summaryTopicTitleSpy.mock.calls[0][2]).toBe(createTopicSpy.mock.calls[0][0]);
      expect(summaryTopicTitleSpy).toHaveBeenCalledWith(
        newTopicId,
        prompts,
        expect.objectContaining({
          account: {
            ownershipInvalidationGeneration: 0,
            scope: 'user:test-user',
          },
          scopeGeneration: 0,
        }),
      );
    });

    it('keeps the server topic available for title generation and activation without a mounted topic list', async () => {
      const { result } = renderHook(() => useImageStore());
      const newTopicId = 'gt_mobile_topic';
      const refreshSpy = vi
        .spyOn(result.current, 'refreshGenerationTopics')
        .mockResolvedValue(undefined);
      const summarySpy = vi
        .spyOn(result.current, 'summaryGenerationTopicTitle')
        .mockImplementation(async (topicId) => {
          expect(useImageStore.getState().generationTopics.some(({ id }) => id === topicId)).toBe(
            true,
          );
          return 'Mobile topic';
        });
      vi.mocked(generationTopicService.createTopic).mockResolvedValue(newTopicId);

      let createdTopicId!: string;
      await act(async () => {
        createdTopicId = await result.current.createGenerationTopic(['Mobile prompt']);
      });

      expect(refreshSpy).toHaveBeenCalled();
      expect(createdTopicId).toBe(newTopicId);
      expect(summarySpy).toHaveBeenCalledWith(newTopicId, ['Mobile prompt'], expect.any(Object));
      expect(useImageStore.getState().generationTopics.map(({ id }) => id)).toEqual([newTopicId]);

      act(() => {
        result.current.switchGenerationTopic(newTopicId);
      });

      expect(useImageStore.getState().activeGenerationTopicId).toBe(newTopicId);
    });

    it('returns no topic id after an A-to-B-to-A reset during creation', async () => {
      const createdTopic = createDeferred<string>();
      vi.mocked(generationTopicService.createTopic).mockReturnValue(createdTopic.promise);
      const { result } = renderHook(() => useImageStore());
      const summaryTopicTitleSpy = vi.spyOn(result.current, 'summaryGenerationTopicTitle');
      let creationPromise!: ReturnType<typeof result.current.createGenerationTopic>;

      act(() => {
        creationPromise = result.current.createGenerationTopic(['Account A prompt']);
      });

      await waitFor(() => {
        expect(generationTopicService.createTopic).toHaveBeenCalled();
      });

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: 'account-a-returned-topic',
          generationTopics: [
            { id: 'account-a-returned-topic', title: 'Current topic' },
          ] as ImageGenerationTopic[],
          loadingGenerationTopicIds: [],
          scopeGeneration: 1,
        });
      });
      createdTopic.resolve('stale-account-a-topic');

      let createdTopicId!: string;
      await act(async () => {
        createdTopicId = await creationPromise;
      });

      expect(createdTopicId).toBe('');
      expect(summaryTopicTitleSpy).not.toHaveBeenCalled();
      expect(useImageStore.getState().activeGenerationTopicId).toBe('account-a-returned-topic');
      expect(useImageStore.getState().generationTopics).toHaveLength(1);
    });

    it('returns no topic id after an account A-to-B-to-A epoch change', async () => {
      const createdTopic = createDeferred<string>();
      vi.mocked(generationTopicService.createTopic).mockReturnValue(createdTopic.promise);
      const { result } = renderHook(() => useImageStore());
      const summaryTopicTitleSpy = vi.spyOn(result.current, 'summaryGenerationTopicTitle');

      let creationPromise!: ReturnType<typeof result.current.createGenerationTopic>;
      act(() => {
        creationPromise = result.current.createGenerationTopic(['Account A prompt']);
      });

      await waitFor(() => {
        expect(generationTopicService.createTopic).toHaveBeenCalled();
      });

      mockedUserState.scope = 'user:account-b';
      mockedUserState.scope = 'user:test-user';
      mockedUserState.ownershipInvalidationGeneration = 1;
      createdTopic.resolve('stale-account-a-topic');

      await act(async () => {
        await expect(creationPromise).resolves.toBe('');
      });

      expect(summaryTopicTitleSpy).not.toHaveBeenCalled();
    });

    it('should throw error when prompts are empty', async () => {
      const { result } = renderHook(() => useImageStore());

      await act(async () => {
        await expect(result.current.createGenerationTopic([])).rejects.toThrow(
          'Prompts cannot be empty when creating a generation topic',
        );
      });

      expect(generationTopicService.createTopic).not.toHaveBeenCalled();
    });

    it('should throw error when prompts are null or undefined', async () => {
      const { result } = renderHook(() => useImageStore());

      await act(async () => {
        await expect(result.current.createGenerationTopic(null as any)).rejects.toThrow(
          'Prompts cannot be empty when creating a generation topic',
        );
      });

      await act(async () => {
        await expect(result.current.createGenerationTopic(undefined as any)).rejects.toThrow(
          'Prompts cannot be empty when creating a generation topic',
        );
      });

      expect(generationTopicService.createTopic).not.toHaveBeenCalled();
    });
  });

  describe('switchGenerationTopic', () => {
    it('should switch to the specified topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const topics = [
        { id: 'gt_topic_1', title: 'Topic 1' },
        { id: 'gt_topic_2', title: 'Topic 2' },
      ] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({ generationTopics: topics });
      });

      act(() => {
        result.current.switchGenerationTopic(topicId);
      });

      expect(result.current.activeGenerationTopicId).toBe(topicId);
    });

    it('should not update if already active topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const topics = [{ id: 'gt_topic_1', title: 'Topic 1' }] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({
          generationTopics: topics,
          activeGenerationTopicId: topicId,
        });
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        result.current.switchGenerationTopic(topicId);
      });

      expect(result.current.activeGenerationTopicId).toBe(topicId);
      consoleSpy.mockRestore();
    });

    it('should warn when topic does not exist', async () => {
      const { result } = renderHook(() => useImageStore());
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        useImageStore.setState({ generationTopics: [] });
      });

      act(() => {
        result.current.switchGenerationTopic('gt_non_existent_topic');
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Generation topic with id gt_non_existent_topic not found',
      );
      consoleSpy.mockRestore();
    });
  });

  describe('openNewGenerationTopic', () => {
    it('should set activeGenerationTopicId to null', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({ activeGenerationTopicId: 'existing-topic' });
      });

      act(() => {
        result.current.openNewGenerationTopic();
      });

      expect(result.current.activeGenerationTopicId).toBeNull();
    });
  });

  describe('summaryGenerationTopicTitle', () => {
    it('should generate title using AI and update topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const prompts = ['A beautiful sunset over mountains'];
      const topics = [{ id: topicId, title: 'Original Title' }] as ImageGenerationTopic[];
      const generatedTitle = 'Mountain Sunset Landscape';

      act(() => {
        useImageStore.setState({ generationTopics: topics });
      });

      // Mock successful AI response
      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation((params) => {
        if (params.onFinish) {
          params.onFinish(generatedTitle, { type: 'done' });
        }
        return Promise.resolve(undefined);
      });

      await act(async () => {
        await result.current.summaryGenerationTopicTitle(topicId, prompts);
      });

      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
      expect(generationTopicService.updateTopic).toHaveBeenCalledWith(topicId, {
        title: generatedTitle,
      });
    });

    it('removes surrounding Markdown emphasis before displaying and persisting a title', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_markdown_title';

      act(() => {
        useImageStore.setState({
          generationTopics: [{ id: topicId, title: 'Original Title' }] as ImageGenerationTopic[],
        });
      });

      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async (params) => {
        params.onMessageHandle?.({ text: '**Flying', type: 'text' });
        params.onMessageHandle?.({ text: ' TV**', type: 'text' });
        await params.onFinish?.('**Flying TV**', { type: 'done' });
      });

      let title = '';
      await act(async () => {
        title = await result.current.summaryGenerationTopicTitle(topicId, ['A flying television']);
      });

      expect(title).toBe('Flying TV');
      expect(useImageStore.getState().generationTopics[0].title).toBe('Flying TV');
      expect(generationTopicService.updateTopic).toHaveBeenCalledWith(topicId, {
        title: 'Flying TV',
      });
    });

    it('should use fallback title when AI fails', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const prompts = ['A beautiful sunset over mountains with clear sky'];
      const topics = [{ id: topicId, title: 'Original Title' }] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({ generationTopics: topics });
      });

      // Mock AI error
      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation((params) => {
        if (params.onError) {
          params.onError(new Error('AI service failed'));
        }
        return Promise.resolve(undefined);
      });

      await act(async () => {
        await result.current.summaryGenerationTopicTitle(topicId, prompts);
      });

      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
      // Should call with fallback title (first 3 words, max 10 chars)
      expect(generationTopicService.updateTopic).toHaveBeenCalledWith(topicId, {
        title: 'A beautifu',
      });
    });

    it('should throw error when topic not found', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({ generationTopics: [] });
      });

      await act(async () => {
        await expect(
          result.current.summaryGenerationTopicTitle('gt_non_existent', ['prompt']),
        ).rejects.toThrow('Topic gt_non_existent not found');
      });
    });

    it('should handle streaming text updates', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const prompts = ['Test prompt'];
      const topics = [{ id: topicId, title: 'Original Title' }] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({ generationTopics: topics });
      });

      const updateTitleSpy = vi.spyOn(
        result.current,
        'internal_updateGenerationTopicTitleInSummary',
      );

      // Mock streaming response
      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation((params) => {
        if (params.onMessageHandle) {
          params.onMessageHandle({ type: 'text', text: 'Streaming' });
          params.onMessageHandle({ type: 'text', text: ' Title' });
        }
        if (params.onFinish) {
          params.onFinish('Streaming Title', { type: 'done' });
        }
        return Promise.resolve(undefined);
      });

      await act(async () => {
        await result.current.summaryGenerationTopicTitle(topicId, prompts);
      });

      expect(updateTitleSpy).toHaveBeenCalledWith(topicId, 'Streaming');
      expect(updateTitleSpy).toHaveBeenCalledWith(topicId, 'Streaming Title');
    });

    it('keeps the newer title and loading owner during overlapping summaries', async () => {
      const firstSummary = createDeferred<void>();
      const secondSummary = createDeferred<void>();
      const summaryCallbacks: Parameters<typeof chatService.fetchPresetTaskResult>[0][] = [];
      vi.mocked(chatService.fetchPresetTaskResult)
        .mockImplementationOnce((params) => {
          summaryCallbacks.push(params);
          return firstSummary.promise;
        })
        .mockImplementationOnce((params) => {
          summaryCallbacks.push(params);
          return secondSummary.promise;
        });
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          generationTopics: [{ id: 'shared-topic', title: 'Original' }] as ImageGenerationTopic[],
        });
      });

      let firstPromise!: Promise<string>;
      let secondPromise!: Promise<string>;
      act(() => {
        firstPromise = result.current.summaryGenerationTopicTitle('shared-topic', ['First']);
      });
      await waitFor(() => expect(summaryCallbacks).toHaveLength(1));
      act(() => {
        summaryCallbacks[0].onMessageHandle?.({ text: 'First title', type: 'text' });
        secondPromise = result.current.summaryGenerationTopicTitle('shared-topic', ['Second']);
      });
      await waitFor(() => expect(summaryCallbacks).toHaveLength(2));
      act(() => {
        summaryCallbacks[1].onMessageHandle?.({ text: 'Second title', type: 'text' });
        firstSummary.resolve();
      });

      await act(async () => {
        await firstPromise;
      });

      expect(useImageStore.getState().generationTopics[0].title).toBe('Second title');
      expect(useImageStore.getState().loadingGenerationTopicIds).toContain('shared-topic');

      secondSummary.resolve();
      await act(async () => {
        await secondPromise;
      });

      expect(useImageStore.getState().loadingGenerationTopicIds).not.toContain('shared-topic');
    });
  });

  describe('removeGenerationTopic', () => {
    it('should remove topic and switch to next topic when removing active topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topics = [
        { id: 'gt_topic_1', title: 'Topic 1' },
        { id: 'gt_topic_2', title: 'Topic 2' },
        { id: 'gt_topic_3', title: 'Topic 3' },
      ] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({
          generationTopics: topics,
          activeGenerationTopicId: 'gt_topic_2',
        });
      });

      vi.mocked(generationTopicService.getAllGenerationTopics).mockResolvedValue([
        { id: 'gt_topic_1', title: 'Topic 1' },
        { id: 'gt_topic_3', title: 'Topic 3' },
      ] as ImageGenerationTopic[]);

      const switchTopicSpy = vi.spyOn(result.current, 'switchGenerationTopic');

      await act(async () => {
        await result.current.removeGenerationTopic('gt_topic_2');
      });

      expect(generationTopicService.deleteTopic).toHaveBeenCalledWith('gt_topic_2');
      expect(switchTopicSpy).toHaveBeenCalled();
    });

    it('should open new topic when removing the last topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topics = [{ id: 'gt_topic_1', title: 'Topic 1' }] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({
          generationTopics: topics,
          activeGenerationTopicId: 'gt_topic_1',
        });
      });

      // Mock getAllGenerationTopics to return empty array after deletion
      vi.mocked(generationTopicService.getAllGenerationTopics).mockResolvedValue([]);

      const openNewTopicSpy = vi.spyOn(result.current, 'openNewGenerationTopic');
      const refreshSpy = vi
        .spyOn(result.current, 'refreshGenerationTopics')
        .mockImplementation(async () => {
          // Simulate state update after refresh - empty topics array
          useImageStore.setState({ generationTopics: [] });
        });

      await act(async () => {
        await result.current.removeGenerationTopic('gt_topic_1');
      });

      expect(generationTopicService.deleteTopic).toHaveBeenCalledWith('gt_topic_1');
      expect(refreshSpy).toHaveBeenCalled();
      expect(openNewTopicSpy).toHaveBeenCalled();
    });

    it('should not switch topic when removing non-active topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topics = [
        { id: 'gt_topic_1', title: 'Topic 1' },
        { id: 'gt_topic_2', title: 'Topic 2' },
      ] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({
          generationTopics: topics,
          activeGenerationTopicId: 'gt_topic_1',
        });
      });

      const switchTopicSpy = vi.spyOn(result.current, 'switchGenerationTopic');
      const openNewTopicSpy = vi.spyOn(result.current, 'openNewGenerationTopic');

      await act(async () => {
        await result.current.removeGenerationTopic('gt_topic_2');
      });

      expect(generationTopicService.deleteTopic).toHaveBeenCalledWith('gt_topic_2');
      expect(switchTopicSpy).not.toHaveBeenCalled();
      expect(openNewTopicSpy).not.toHaveBeenCalled();
    });

    it('does not navigate or clear current loading after a stale deletion completes', async () => {
      const deletionFinished = createDeferred<void>();
      vi.mocked(generationTopicService.deleteTopic).mockReturnValue(deletionFinished.promise);
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: 'shared-topic',
          generationTopics: [
            { id: 'shared-topic', title: 'Account A topic' },
          ] as ImageGenerationTopic[],
        });
      });

      const switchTopicSpy = vi.spyOn(result.current, 'switchGenerationTopic');
      const openNewTopicSpy = vi.spyOn(result.current, 'openNewGenerationTopic');
      const refreshSpy = vi.spyOn(result.current, 'refreshGenerationTopics').mockResolvedValue();
      let removalPromise!: ReturnType<typeof result.current.removeGenerationTopic>;

      act(() => {
        removalPromise = result.current.removeGenerationTopic('shared-topic');
      });

      await waitFor(() => {
        expect(generationTopicService.deleteTopic).toHaveBeenCalledWith('shared-topic');
      });

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: 'account-a-returned-topic',
          generationTopics: [
            { id: 'shared-topic', title: 'Current shared topic' },
            { id: 'account-a-returned-topic', title: 'Current active topic' },
          ] as ImageGenerationTopic[],
          loadingGenerationTopicIds: ['shared-topic'],
          scopeGeneration: 1,
        });
      });
      deletionFinished.resolve();

      await act(async () => {
        await removalPromise;
      });

      expect(refreshSpy).not.toHaveBeenCalled();
      expect(switchTopicSpy).not.toHaveBeenCalled();
      expect(openNewTopicSpy).not.toHaveBeenCalled();
      expect(useImageStore.getState().activeGenerationTopicId).toBe('account-a-returned-topic');
      expect(useImageStore.getState().loadingGenerationTopicIds).toEqual(['shared-topic']);
    });

    it('does not start deletion during an active same-scope owner mismatch', async () => {
      const { result } = renderHook(() => useImageStore());
      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: 'shared-topic',
          generationTopics: [
            { id: 'shared-topic', title: 'Current topic' },
          ] as ImageGenerationTopic[],
        });
      });
      mockedUserState.ownerMismatch = true;
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');

      await act(async () => {
        await result.current.removeGenerationTopic('shared-topic');
      });

      expect(generationTopicService.deleteTopic).not.toHaveBeenCalled();
      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(useImageStore.getState().loadingGenerationTopicIds).toEqual([]);
    });
  });

  describe('useFetchGenerationTopics', () => {
    it('should fetch generation topics and normalize legacy Markdown titles when enabled', async () => {
      const topics = [
        { id: 'gt_topic_1', title: '**Topic 1**', createdAt: new Date(), updatedAt: new Date() },
        { id: 'gt_topic_2', title: 'Topic 2', createdAt: new Date(), updatedAt: new Date() },
      ] as ImageGenerationTopic[];
      const expectedTopics = [{ ...topics[0], title: 'Topic 1' }, topics[1]];

      vi.mocked(generationTopicService.getAllGenerationTopics).mockResolvedValue(topics);

      await act(async () => {
        renderHook(() => {
          const store = useImageStore();
          return store.useFetchGenerationTopics(true);
        });
      });

      // Wait for service to be called and state to be updated
      await waitFor(() => {
        expect(generationTopicService.getAllGenerationTopics).toHaveBeenCalled();
        expect(useImageStore.getState().generationTopics).toEqual(expectedTopics);
      });
    });

    it('should not fetch when disabled', async () => {
      const { result } = renderHook(() => useImageStore().useFetchGenerationTopics(false));

      expect(result.current.data).toBeUndefined();
      expect(generationTopicService.getAllGenerationTopics).not.toHaveBeenCalled();
    });
  });

  describe('refreshGenerationTopics', () => {
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
      vi.resetAllMocks();
    });

    it('should call mutate to refresh topics', async () => {
      const { result } = renderHook(() => useImageStore());

      await act(async () => {
        await result.current.refreshGenerationTopics();
      });

      expect(mutate).toHaveBeenCalledWith([
        'fetchGenerationTopics',
        'user:test-user',
        ['account-cache-epoch', 0],
      ]);
    });
  });

  describe('updateGenerationTopicCover', () => {
    it('should update topic cover with optimistic update', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const coverUrl = 'https://example.com/cover.jpg';
      const topics = [{ id: topicId, title: 'Topic 1', coverUrl: '' }] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({ generationTopics: topics });
      });

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');
      const updateCoverSpy = vi.spyOn(result.current, 'internal_updateGenerationTopicCover');
      const refreshSpy = vi.spyOn(result.current, 'refreshGenerationTopics');

      await act(async () => {
        await result.current.updateGenerationTopicCover(topicId, coverUrl);
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        { type: 'updateTopic', id: topicId, value: { coverUrl } },
        'internal_updateGenerationTopicCover/optimistic',
      );
      expect(generationTopicService.updateTopicCover).toHaveBeenCalledWith(topicId, coverUrl);
      expect(refreshSpy.mock.calls[0][0]).toBe(updateCoverSpy.mock.calls[0][2]);
      expect(refreshSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          account: {
            ownershipInvalidationGeneration: 0,
            scope: 'user:test-user',
          },
          scopeGeneration: 0,
        }),
      );
    });

    it('preserves current cover and loading state after a stale update completes', async () => {
      const coverUpdateFinished = createDeferred<void>();
      vi.mocked(generationTopicService.updateTopicCover).mockReturnValue(
        coverUpdateFinished.promise,
      );
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          generationTopics: [
            { coverUrl: 'account-a-cover', id: 'shared-topic', title: 'Account A topic' },
          ] as ImageGenerationTopic[],
        });
      });

      const refreshSpy = vi.spyOn(result.current, 'refreshGenerationTopics').mockResolvedValue();
      let updatePromise!: ReturnType<typeof result.current.updateGenerationTopicCover>;

      act(() => {
        updatePromise = result.current.updateGenerationTopicCover(
          'shared-topic',
          'stale-account-a-cover',
        );
      });

      await waitFor(() => {
        expect(generationTopicService.updateTopicCover).toHaveBeenCalledWith(
          'shared-topic',
          'stale-account-a-cover',
        );
      });

      act(() => {
        useImageStore.setState({
          generationTopics: [
            { coverUrl: 'current-cover', id: 'shared-topic', title: 'Current topic' },
          ] as ImageGenerationTopic[],
          loadingGenerationTopicIds: ['shared-topic'],
          scopeGeneration: 1,
        });
      });
      coverUpdateFinished.resolve();

      await act(async () => {
        await updatePromise;
      });

      expect(refreshSpy).not.toHaveBeenCalled();
      expect(useImageStore.getState().generationTopics[0].coverUrl).toBe('current-cover');
      expect(useImageStore.getState().loadingGenerationTopicIds).toEqual(['shared-topic']);
    });

    it('does not let an older cover update clear the newer loading owner', async () => {
      const firstCoverUpdate = createDeferred<void>();
      const secondCoverUpdate = createDeferred<void>();
      vi.mocked(generationTopicService.updateTopicCover)
        .mockReturnValueOnce(firstCoverUpdate.promise)
        .mockReturnValueOnce(secondCoverUpdate.promise);
      const { result } = renderHook(() => useImageStore());
      const refreshSpy = vi.spyOn(result.current, 'refreshGenerationTopics').mockResolvedValue();

      act(() => {
        useImageStore.setState({
          generationTopics: [
            { coverUrl: 'original-cover', id: 'shared-topic', title: 'Topic' },
          ] as ImageGenerationTopic[],
        });
      });

      let firstPromise!: Promise<void>;
      let secondPromise!: Promise<void>;
      act(() => {
        firstPromise = result.current.updateGenerationTopicCover('shared-topic', 'first-cover');
        secondPromise = result.current.updateGenerationTopicCover('shared-topic', 'second-cover');
      });
      firstCoverUpdate.resolve();
      await act(async () => {
        await firstPromise;
      });

      expect(refreshSpy).not.toHaveBeenCalled();
      expect(useImageStore.getState().generationTopics[0].coverUrl).toBe('second-cover');
      expect(useImageStore.getState().loadingGenerationTopicIds).toContain('shared-topic');

      secondCoverUpdate.resolve();
      await act(async () => {
        await secondPromise;
      });

      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(useImageStore.getState().loadingGenerationTopicIds).not.toContain('shared-topic');
    });
  });

  describe('internal_updateGenerationTopicLoading', () => {
    it('should add topic id to loading array when loading is true', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        useImageStore.setState({ loadingGenerationTopicIds: [] });
      });

      act(() => {
        result.current.internal_updateGenerationTopicLoading(topicId, true);
      });

      expect(result.current.loadingGenerationTopicIds).toContain(topicId);
    });

    it('should remove topic id from loading array when loading is false', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        useImageStore.setState({ loadingGenerationTopicIds: [topicId] });
      });

      act(() => {
        result.current.internal_updateGenerationTopicLoading(topicId, false);
      });

      expect(result.current.loadingGenerationTopicIds).not.toContain(topicId);
    });
  });

  describe('internal_dispatchGenerationTopic', () => {
    it('should update topics when state changes', async () => {
      const { result } = renderHook(() => useImageStore());
      const initialTopics = [{ id: 'gt_topic_1', title: 'Topic 1' }] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({ generationTopics: initialTopics });
      });

      act(() => {
        result.current.internal_dispatchGenerationTopic({
          type: 'addTopic',
          value: { id: 'gt_topic_2', title: 'Topic 2' },
        });
      });

      expect(result.current.generationTopics).toHaveLength(2);
      expect(result.current.generationTopics.find((t) => t.id === 'gt_topic_2')).toBeDefined();
    });

    it('should not update when topics are equal', async () => {
      const { result } = renderHook(() => useImageStore());
      const existingDate = new Date('2024-01-01T00:00:00.000Z');
      const topics = [
        {
          id: 'gt_topic_1',
          title: 'Topic 1',
          createdAt: existingDate,
          updatedAt: existingDate,
        },
      ] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({ generationTopics: topics });
      });

      const stateBefore = result.current.generationTopics;

      act(() => {
        result.current.internal_dispatchGenerationTopic({
          type: 'updateTopic',
          id: 'gt_topic_1',
          value: { title: 'Topic 1' }, // Same title, but updatedAt will still change
        });
      });

      // The state object reference should change due to updatedAt being updated
      expect(result.current.generationTopics).not.toBe(stateBefore);
      // But the topic should still exist with updated timestamp
      expect(result.current.generationTopics[0].id).toBe('gt_topic_1');
      expect(result.current.generationTopics[0].title).toBe('Topic 1');
      expect(result.current.generationTopics[0].updatedAt.getTime()).toBeGreaterThan(
        existingDate.getTime(),
      );
    });
  });

  describe('internal_createGenerationTopic', () => {
    it('should promote the optimistic topic to the server id before refreshing', async () => {
      const { result } = renderHook(() => useImageStore());
      const newTopicId = 'gt_new_topic';

      vi.mocked(generationTopicService.createTopic).mockResolvedValue(newTopicId);
      vi.mocked(generationTopicService.getAllGenerationTopics).mockResolvedValue([
        {
          id: newTopicId,
          title: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as ImageGenerationTopic[]);

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');
      const loadingSpy = vi.spyOn(result.current, 'internal_updateGenerationTopicLoading');

      await act(async () => {
        const topicId = await result.current.internal_createGenerationTopic();
        expect(topicId).toBe(newTopicId);
      });

      expect(dispatchSpy).toHaveBeenCalled();
      expect(loadingSpy).toHaveBeenCalledWith(expect.any(String), true);
      expect(loadingSpy).toHaveBeenCalledWith(newTopicId, false);
      expect(generationTopicService.createTopic).toHaveBeenCalled();
      expect(useImageStore.getState().generationTopics.map(({ id }) => id)).toEqual([newTopicId]);
      expect(dispatchSpy).toHaveBeenCalledWith(
        { type: 'replaceTopic', id: expect.any(String), value: { id: newTopicId } },
        'internal_createGenerationTopic/promote',
      );
    });
  });

  describe('internal_updateGenerationTopic', () => {
    it('should update topic with optimistic update and refresh', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const updateData = { title: 'Updated Title' };

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');
      const loadingSpy = vi.spyOn(result.current, 'internal_updateGenerationTopicLoading');
      const refreshSpy = vi.spyOn(result.current, 'refreshGenerationTopics');
      const mutationContext = {
        account: {
          ownershipInvalidationGeneration: 0,
          scope: 'user:test-user',
        },
        scopeGeneration: 0,
      };

      await act(async () => {
        await result.current.internal_updateGenerationTopic(topicId, updateData, mutationContext);
      });

      expect(dispatchSpy).toHaveBeenCalledWith({
        type: 'updateTopic',
        id: topicId,
        value: updateData,
      });
      expect(loadingSpy).toHaveBeenCalledWith(topicId, true);
      expect(generationTopicService.updateTopic).toHaveBeenCalledWith(topicId, updateData);
      expect(refreshSpy).toHaveBeenCalledWith(mutationContext);
      expect(refreshSpy.mock.calls[0][0]).toBe(mutationContext);
      expect(loadingSpy).toHaveBeenCalledWith(topicId, false);
    });
  });

  describe('internal_updateGenerationTopicTitleInSummary', () => {
    it('should dispatch title update action', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const title = 'Summary Title';

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');

      act(() => {
        result.current.internal_updateGenerationTopicTitleInSummary(topicId, title);
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        { type: 'updateTopic', id: topicId, value: { title } },
        'updateGenerationTopicTitleInSummary',
      );
    });
  });

  describe('internal_removeGenerationTopic', () => {
    it('should handle removal with loading states', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      const loadingSpy = vi.spyOn(result.current, 'internal_updateGenerationTopicLoading');
      const refreshSpy = vi.spyOn(result.current, 'refreshGenerationTopics');
      const mutationContext = {
        account: {
          ownershipInvalidationGeneration: 0,
          scope: 'user:test-user',
        },
        scopeGeneration: 0,
      };

      await act(async () => {
        await result.current.internal_removeGenerationTopic(topicId, mutationContext);
      });

      expect(loadingSpy).toHaveBeenCalledWith(topicId, true);
      expect(generationTopicService.deleteTopic).toHaveBeenCalledWith(topicId);
      expect(refreshSpy).toHaveBeenCalledWith(mutationContext);
      expect(refreshSpy.mock.calls[0][0]).toBe(mutationContext);
      expect(loadingSpy).toHaveBeenCalledWith(topicId, false);
    });

    it('should clear loading state even if deletion fails', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      vi.mocked(generationTopicService.deleteTopic).mockRejectedValue(new Error('Delete failed'));

      const loadingSpy = vi.spyOn(result.current, 'internal_updateGenerationTopicLoading');

      await act(async () => {
        await expect(result.current.internal_removeGenerationTopic(topicId)).rejects.toThrow(
          'Delete failed',
        );
      });

      expect(loadingSpy).toHaveBeenCalledWith(topicId, true);
      expect(loadingSpy).toHaveBeenCalledWith(topicId, false);
    });
  });

  describe('housekeepGenerationTopics', () => {
    it('previews housekeeping for the current account scope', async () => {
      vi.mocked(generationTopicService.previewHousekeeping).mockResolvedValue({
        cutoffAt: new Date('2026-07-05T00:00:00Z'),
        deletableTopicCount: 2,
        skippedActiveTopicCount: 1,
      });

      const result = await useImageStore
        .getState()
        .previewGenerationTopicHousekeeping({ days: 30, mode: 'olderThan' });

      expect(generationTopicService.previewHousekeeping).toHaveBeenCalledWith({
        days: 30,
        mode: 'olderThan',
      });
      expect(result.deletableTopicCount).toBe(2);
    });

    it('refreshes topics and leaves a deleted active topic', async () => {
      useImageStore.setState({
        activeGenerationTopicId: 'deleted-topic',
        generationTopics: [
          { id: 'deleted-topic', title: 'Deleted' },
          { id: 'remaining-topic', title: 'Remaining' },
        ] as ImageGenerationTopic[],
      });
      vi.mocked(generationTopicService.housekeep).mockResolvedValue({
        cutoffAt: null,
        deletedTopicIds: ['deleted-topic'],
        deletableTopicCount: 1,
        skippedActiveTopicCount: 0,
      });
      vi.spyOn(useImageStore.getState(), 'refreshGenerationTopics').mockImplementation(async () => {
        useImageStore.setState({
          generationTopics: [
            { id: 'remaining-topic', title: 'Remaining' },
          ] as ImageGenerationTopic[],
        });
      });

      const result = await useImageStore.getState().housekeepGenerationTopics({ mode: 'all' });

      expect(result.deletedTopicIds).toEqual(['deleted-topic']);
      expect(useImageStore.getState().activeGenerationTopicId).toBe('remaining-topic');
    });
  });
});
