import { LOADING_FLAT } from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { conversationGenerationService } from '@/services/conversationGeneration';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useChatStore } from '../../../../store';
import { TEST_IDS, createMockStoreState } from './fixtures';
import { resetTestEnvironment } from './helpers';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

describe('conversationGeneration store actions', () => {
  beforeEach(() => {
    resetTestEnvironment();
    act(() => {
      useChatStore.setState({
        ...createMockStoreState(),
        internal_dispatchMessage: vi.fn(),
        internal_toggleSupervisorLoading: vi.fn(),
        refreshMessages: vi.fn(() => Promise.resolve()),
        refreshTopic: vi.fn(() => Promise.resolve()),
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches an operation and marks the assistant as generating', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_one',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
    });

    const key = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);
    expect(useChatStore.getState().serverGenerationOperations[key]['cgo_one'].operationId).toBe(
      'cgo_one',
    );
    expect(useChatStore.getState().chatLoadingIds).toContain(TEST_IDS.ASSISTANT_MESSAGE_ID);
  });

  it('moves the generating spinner when a snapshot introduces a new assistant id', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.attachConversationGeneration({
        assistantMessageId: 'assistant-1',
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_one',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.applyConversationGenerationEvent({
        createdAt: new Date().toISOString(),
        id: 1,
        operationId: 'cgo_one',
        payload: { assistantMessageId: 'assistant-2', content: 'next turn' },
        revision: 2,
        type: 'snapshot',
        userId: 'user-1',
      });
    });

    const key = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);
    expect(
      useChatStore.getState().serverGenerationOperations[key]['cgo_one'].assistantMessageId,
    ).toBe('assistant-2');
    expect(useChatStore.getState().chatLoadingIds).toEqual(['assistant-2']);
    expect(useChatStore.getState().refreshMessages).toHaveBeenCalled();
  });

  it('applies snapshots to an attached operation after switching topics', () => {
    const { result } = renderHook(() => useChatStore());
    const dispatch = vi.fn();

    act(() => {
      useChatStore.setState({
        activeTopicId: TEST_IDS.TOPIC_ID,
        conversationClearGeneration: 0,
        internal_dispatchMessage: dispatch,
      });
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_one',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      useChatStore.setState({ activeTopicId: 'other-topic' });
      result.current.applyConversationGenerationEvent({
        createdAt: new Date().toISOString(),
        id: 1,
        operationId: 'cgo_one',
        payload: { content: 'background text' },
        revision: 2,
        type: 'snapshot',
        userId: 'user-1',
      });
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TEST_IDS.ASSISTANT_MESSAGE_ID,
        type: 'updateMessage',
        value: { content: 'background text' },
      }),
      { sessionId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
    );
  });

  it('clears supervisor loading and detaches on done', () => {
    const { result } = renderHook(() => useChatStore());
    const toggleSupervisor = vi.fn();

    act(() => {
      useChatStore.setState({ internal_toggleSupervisorLoading: toggleSupervisor });
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        groupId: 'group-1',
        kind: 'group_supervisor',
        lane: 'lane-group',
        operationId: 'cgo_one',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.applyConversationGenerationEvent({
        createdAt: new Date().toISOString(),
        id: 2,
        operationId: 'cgo_one',
        payload: { status: 'succeeded' },
        revision: 3,
        type: 'done',
        userId: 'user-1',
      });
    });

    expect(toggleSupervisor).toHaveBeenCalledWith(false, 'group-1');
    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ],
    ).toBeUndefined();
    expect(useChatStore.getState().refreshMessages).toHaveBeenCalled();
  });

  it('ignores snapshots after the conversation generation was invalidated', () => {
    const { result } = renderHook(() => useChatStore());
    const dispatch = vi.fn();
    act(() => {
      useChatStore.setState({ internal_dispatchMessage: dispatch });
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_one',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      useChatStore.setState({ conversationClearGeneration: 1 });
      result.current.applyConversationGenerationEvent({
        createdAt: new Date().toISOString(),
        id: 3,
        operationId: 'cgo_one',
        payload: { content: 'stale' },
        revision: 4,
        type: 'snapshot',
        userId: 'user-1',
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rebases generation when re-attaching after navigation invalidate', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useChatStore());

    act(() => {
      useChatStore.setState({ internal_dispatchMessage: dispatch });
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_late',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.internal_invalidateConversation();
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_late',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
    });

    const attached =
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ]['cgo_late'];
    expect(attached.generation).toBe(useChatStore.getState().conversationNavigationGeneration);

    act(() => {
      result.current.applyConversationGenerationEvent({
        createdAt: new Date().toISOString(),
        id: 4,
        operationId: 'cgo_late',
        payload: { content: 'synced answer' },
        revision: 5,
        type: 'snapshot',
        userId: 'user-1',
      });
      result.current.applyConversationGenerationEvent({
        createdAt: new Date().toISOString(),
        id: 5,
        operationId: 'cgo_late',
        payload: { status: 'succeeded' },
        revision: 6,
        type: 'done',
        userId: 'user-1',
      });
    });

    expect(dispatch).toHaveBeenCalled();
    expect(useChatStore.getState().chatLoadingIds).toEqual([]);
    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ],
    ).toBeUndefined();
  });

  it('rejects attach and events after destructive clear generation bump', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useChatStore());

    act(() => {
      useChatStore.setState({ internal_dispatchMessage: dispatch });
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_cleared',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      useChatStore.setState({ conversationClearGeneration: 1 });
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_cleared',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.applyConversationGenerationEvent({
        createdAt: new Date().toISOString(),
        id: 6,
        operationId: 'cgo_cleared',
        payload: { content: 'should not apply' },
        revision: 7,
        type: 'snapshot',
        userId: 'user-1',
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ]?.cgo_cleared,
    ).toBeDefined();
  });

  it('ignores replayed events at or below the attached revision', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useChatStore());
    act(() => {
      useChatStore.setState({ internal_dispatchMessage: dispatch });
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_replayed',
        revision: 4,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.applyConversationGenerationEvent({
        createdAt: new Date().toISOString(),
        id: 3,
        operationId: 'cgo_replayed',
        payload: { content: 'old content' },
        revision: 4,
        type: 'snapshot',
        userId: 'user-1',
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('detaches operations after stop', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      result.current.attachConversationGeneration({
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_active',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      await result.current.stopDurableConversationGeneration();
    });

    expect(cancel).toHaveBeenCalledWith('cgo_active');
    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ],
    ).toBeUndefined();
  });

  it('sends cancel only for operations in the active conversation', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      result.current.attachConversationGeneration({
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_active',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.attachConversationGeneration({
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-other',
        operationId: 'cgo_other',
        sessionId: 'other-session',
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      await result.current.stopDurableConversationGeneration();
    });

    expect(cancel).toHaveBeenCalledWith('cgo_active');
    expect(cancel).not.toHaveBeenCalledWith('cgo_other');
  });

  it('applies snapshots to an attached thread operation even when that thread is hidden', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useChatStore());
    act(() => {
      useChatStore.setState({ activeThreadId: undefined, internal_dispatchMessage: dispatch });
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-thread',
        operationId: 'cgo_thread',
        sessionId: TEST_IDS.SESSION_ID,
        threadId: 'thread-1',
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.applyConversationGenerationEvent({
        createdAt: new Date().toISOString(),
        id: 4,
        operationId: 'cgo_thread',
        payload: { content: 'hidden update' },
        revision: 1,
        type: 'snapshot',
        userId: 'user-1',
      });
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TEST_IDS.ASSISTANT_MESSAGE_ID,
        value: expect.objectContaining({ content: 'hidden update' }),
      }),
      { sessionId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
    );
  });

  it('stops only the exact active thread lane', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      useChatStore.setState({ activeThreadId: 'thread-1' });
      result.current.attachConversationGeneration({
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_main',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.attachConversationGeneration({
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-thread',
        operationId: 'cgo_thread',
        sessionId: TEST_IDS.SESSION_ID,
        threadId: 'thread-1',
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      await result.current.stopDurableConversationGeneration({ threadId: 'thread-1' });
    });

    expect(cancel).toHaveBeenCalledWith('cgo_thread');
    expect(cancel).not.toHaveBeenCalledWith('cgo_main');
  });

  it('uses operation kind to stop a supervisor without cancelling group agents', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      result.current.attachConversationGeneration({
        clearGeneration: 0,
        generation: 0,
        groupId: 'group-1',
        kind: 'group_supervisor',
        lane: 'lane-supervisor',
        operationId: 'cgo_supervisor',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.attachConversationGeneration({
        clearGeneration: 0,
        generation: 0,
        groupId: 'group-1',
        kind: 'group_agent',
        lane: 'lane-agent',
        operationId: 'cgo_agent',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      await result.current.stopDurableConversationGeneration({ kind: 'group_supervisor' });
    });

    expect(cancel).toHaveBeenCalledWith('cgo_supervisor');
    expect(cancel).not.toHaveBeenCalledWith('cgo_agent');
  });

  it('cancels only durable operations whose assistant message is being deleted', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      result.current.attachConversationGeneration({
        assistantMessageId: 'assistant-keep',
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-keep',
        operationId: 'cgo_keep',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.attachConversationGeneration({
        assistantMessageId: 'assistant-delete',
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-delete',
        operationId: 'cgo_delete',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      await result.current.cancelAndDetachDurableOps({
        assistantMessageIds: ['assistant-delete'],
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      });
    });

    expect(cancel).toHaveBeenCalledWith('cgo_delete');
    expect(cancel).not.toHaveBeenCalledWith('cgo_keep');
  });

  it('syncs only the active thread and preserves server lane metadata', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([
      {
        assistantMessageId: 'assistant-thread',
        id: 'cgo_thread',
        kind: 'chat',
        lane: 'lane-thread',
        laneGeneration: 4,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        threadId: 'thread-1',
        topicId: TEST_IDS.TOPIC_ID,
      },
      {
        id: 'cgo_hidden',
        kind: 'chat',
        lane: 'lane-hidden',
        laneGeneration: 2,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        threadId: 'thread-2',
        topicId: TEST_IDS.TOPIC_ID,
      },
    ] as any);
    act(() => {
      useChatStore.setState({ activeThreadId: 'thread-1' });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    const operations =
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ];
    expect(operations.cgo_thread).toMatchObject({
      kind: 'chat',
      lane: 'lane-thread',
      laneGeneration: 4,
      threadId: 'thread-1',
    });
    expect(operations.cgo_hidden).toBeUndefined();
  });

  it('applies snapshots for the open portal thread even when activeThreadId is empty', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useChatStore());
    act(() => {
      useChatStore.setState({
        activeThreadId: undefined,
        internal_dispatchMessage: dispatch,
        portalThreadId: 'thread-1',
      });
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-thread',
        operationId: 'cgo_portal',
        sessionId: TEST_IDS.SESSION_ID,
        threadId: 'thread-1',
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.applyConversationGenerationEvent({
        createdAt: new Date().toISOString(),
        id: 5,
        operationId: 'cgo_portal',
        payload: { content: 'portal update' },
        revision: 1,
        type: 'snapshot',
        userId: 'user-1',
      });
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TEST_IDS.ASSISTANT_MESSAGE_ID,
        value: expect.objectContaining({ content: 'portal update' }),
      }),
      expect.anything(),
    );
  });

  it('syncs the portal thread when that is the visible conversation', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([
      {
        assistantMessageId: 'assistant-portal',
        groupId: 'group-1',
        id: 'cgo_portal',
        kind: 'group_supervisor',
        lane: 'lane-portal',
        laneGeneration: 2,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        threadId: 'thread-1',
        topicId: TEST_IDS.TOPIC_ID,
      },
    ] as any);
    const toggleSupervisor = vi.fn();
    act(() => {
      useChatStore.setState({
        activeThreadId: undefined,
        internal_toggleSupervisorLoading: toggleSupervisor,
        portalThreadId: 'thread-1',
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ].cgo_portal,
    ).toMatchObject({ threadId: 'thread-1' });
    expect(toggleSupervisor).toHaveBeenCalledWith(true, 'group-1');
  });

  it('does not detach a send that started after stop collected its targets', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(conversationGenerationService, 'cancel').mockImplementation(async (id) => {
      if (id === 'cgo_old') await gate;
      return {} as any;
    });
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      result.current.attachConversationGeneration({
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-old',
        operationId: 'cgo_old',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
    });

    let stopPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      stopPromise = result.current.cancelAndDetachDurableOps();
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-new',
        operationId: 'cgo_new',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      release();
      await stopPromise;
    });

    const ops =
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ];
    expect(ops['cgo_new']?.operationId).toBe('cgo_new');
    expect(ops['cgo_old']).toBeUndefined();
  });

  it('does not cancel a topic title when Stop uses the default chat family', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      result.current.attachConversationGeneration({
        clearGeneration: 0,
        generation: 0,
        kind: 'topic_title',
        lane: 'lane-title',
        operationId: 'cgo_title',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.attachConversationGeneration({
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-chat',
        operationId: 'cgo_chat',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      await result.current.stopDurableConversationGeneration();
    });

    expect(cancel).toHaveBeenCalledWith('cgo_chat');
    expect(cancel).not.toHaveBeenCalledWith('cgo_title');
  });

  it('refreshes messages when returning to a loading placeholder with no active job', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValueOnce([] as any);
    const refreshMessages = vi.fn(async () => {});
    const refreshTopic = vi.fn(async () => {});

    act(() => {
      useChatStore.setState({
        activeId: TEST_IDS.SESSION_ID,
        activeTopicId: TEST_IDS.TOPIC_ID,
        messagesMap: {
          [messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)]: [
            {
              content: LOADING_FLAT,
              id: TEST_IDS.ASSISTANT_MESSAGE_ID,
              role: 'assistant',
            },
          ],
        },
        refreshMessages,
        refreshTopic,
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(refreshMessages).toHaveBeenCalled();
    expect(refreshTopic).toHaveBeenCalled();
  });

  it('reconciles a finished operation into its own conversation after switching topics', async () => {
    vi.spyOn(conversationGenerationService, 'getOperation').mockResolvedValueOnce({
      id: 'cgo_one',
      sessionId: TEST_IDS.SESSION_ID,
      status: 'succeeded',
      topicId: TEST_IDS.TOPIC_ID,
    } as any);
    const refreshMessages = vi.fn(async () => {});
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      useChatStore.setState({
        activeTopicId: 'other-topic',
        refreshMessages,
      });
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-main',
        operationId: 'cgo_one',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      await result.current.reconcileConversationGeneration('cgo_one');
    });

    expect(refreshMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      }),
    );
  });
});
