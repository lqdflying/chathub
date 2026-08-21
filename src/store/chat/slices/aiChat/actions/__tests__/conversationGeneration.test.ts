import { LOADING_FLAT } from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as generationDebugClient from '@/libs/logger/generationDebugClient';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { deferredBrowserGenerationLaneKey } from '@/store/chat/utils/deferredBrowserGeneration';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useChatStore } from '../../../../store';
import { TEST_IDS, createMockStoreState } from './fixtures';
import { resetTestEnvironment } from './helpers';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

describe('conversationGeneration store actions', () => {
  beforeEach(() => {
    resetTestEnvironment();
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);
    vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
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

  it('tombstones an attached supervisor operation so a failed cancel cannot reattach via sync', async () => {
    const cancel = vi
      .spyOn(conversationGenerationService, 'cancel')
      .mockRejectedValue(new Error('cancel lost'));
    const listActive = vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);
    const { result } = renderHook(() => useChatStore());
    const topicKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);
    const laneKey = `${topicKey}:main`;

    await act(async () => {
      result.current.attachConversationGeneration({
        clearGeneration: 0,
        generation: 0,
        groupId: 'group-1',
        kind: 'group_supervisor',
        lane: 'lane-supervisor',
        laneGeneration: 3,
        operationId: 'cgo_supervisor',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      await result.current.stopDurableConversationGeneration({ kind: 'group_supervisor' });
    });

    // The attached operation is tombstoned even though its cancel failed.
    expect(
      useChatStore.getState().conversationLaneStopMarkers[laneKey]?.stoppedOperationIds,
    ).toContain('cgo_supervisor');
    expect(
      useChatStore.getState().serverGenerationOperations[topicKey]?.cgo_supervisor,
    ).toBeUndefined();

    // A later sync rediscovers the still-processing supervisor operation: the
    // marker fences it, sync re-cancels, and it is never reattached.
    listActive.mockResolvedValue([
      {
        id: 'cgo_supervisor',
        idempotencyKey: 'group-supervisor:group-1:3',
        kind: 'group_supervisor',
        lane: 'lane-supervisor',
        laneGeneration: 3,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        topicId: TEST_IDS.TOPIC_ID,
      },
    ] as any);

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(cancel).toHaveBeenCalledWith('cgo_supervisor');
    expect(
      useChatStore.getState().serverGenerationOperations[topicKey]?.cgo_supervisor,
    ).toBeUndefined();
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

  it('re-cancels and skips attach when the lane is marked stopped', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const laneKey = `${messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)}:main`;
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([
      {
        id: 'cgo_stopped_lane',
        kind: 'chat',
        lane: 'lane-stopped',
        laneGeneration: 2,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        topicId: TEST_IDS.TOPIC_ID,
      },
    ] as any);

    act(() => {
      useChatStore.setState({
        conversationLaneStopMarkers: {
          [laneKey]: {
            laneGenerations: { 'lane-stopped': 2 },
            stoppedIdempotencyKeys: [],
            stoppedOperationIds: ['cgo_stopped_lane'],
          },
        },
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(cancel).toHaveBeenCalledWith('cgo_stopped_lane');
    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ]?.cgo_stopped_lane,
    ).toBeUndefined();
  });

  it('allows attach when sync discovers a newer lane generation after Stop', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([
      {
        id: 'cgo_replacement',
        kind: 'chat',
        lane: 'lane-replacement',
        laneGeneration: 4,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        topicId: TEST_IDS.TOPIC_ID,
      },
    ] as any);
    const laneKey = `${messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)}:main`;

    act(() => {
      useChatStore.setState({
        conversationLaneStopMarkers: {
          [laneKey]: {
            laneGenerations: { 'lane-replacement': 3 },
            stoppedIdempotencyKeys: [],
            stoppedOperationIds: ['cgo_old'],
          },
        },
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(cancel).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ]?.cgo_replacement,
    ).toMatchObject({ operationId: 'cgo_replacement' });
  });

  it('allows a replacement group supervisor after Stop when lane generation advances', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const toggleSupervisor = vi.fn();
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([
      {
        groupId: 'group-1',
        id: 'cgo_group_replacement',
        kind: 'group_supervisor',
        lane: 'lane-group',
        laneGeneration: 5,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        topicId: TEST_IDS.TOPIC_ID,
      },
    ] as any);
    const laneKey = `${messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)}:main`;

    act(() => {
      useChatStore.setState({
        conversationLaneStopMarkers: {
          [laneKey]: {
            laneGenerations: { 'lane-group': 4 },
            stoppedIdempotencyKeys: [],
            stoppedOperationIds: ['cgo_group_old'],
          },
        },
        internal_toggleSupervisorLoading: toggleSupervisor,
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(cancel).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ]?.cgo_group_replacement,
    ).toMatchObject({ operationId: 'cgo_group_replacement', kind: 'group_supervisor' });
    expect(toggleSupervisor).toHaveBeenCalledWith(true, 'group-1');
  });

  it('does not cancel a portal operation on a different server lane after a main-lane Stop', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const mainLaneKey = `${messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)}:main`;
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([
      {
        id: 'cgo_portal',
        kind: 'chat',
        lane: 'lane-portal',
        laneGeneration: 1,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        threadId: 'thread-1',
        topicId: TEST_IDS.TOPIC_ID,
      },
    ] as any);

    act(() => {
      useChatStore.setState({
        activeThreadId: 'thread-1',
        conversationLaneStopMarkers: {
          [mainLaneKey]: {
            laneGenerations: { 'lane-main': 5 },
            stoppedIdempotencyKeys: [],
            stoppedOperationIds: ['cgo_main_stopped'],
          },
        },
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(cancel).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ]?.cgo_portal,
    ).toMatchObject({ operationId: 'cgo_portal', threadId: 'thread-1' });
  });

  it('does not cancel a different server lane through a topic-wide tombstone cutoff', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const topicKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([
      {
        id: 'cgo_other_lane',
        kind: 'chat',
        lane: 'lane-other',
        laneGeneration: 1,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        topicId: TEST_IDS.TOPIC_ID,
      },
    ] as any);

    act(() => {
      useChatStore.setState({
        conversationLaneStopMarkers: {
          [topicKey]: {
            laneGenerations: { 'lane-main': 5 },
            stoppedIdempotencyKeys: [],
            stoppedOperationIds: ['cgo_main_stopped'],
          },
        },
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(cancel).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().serverGenerationOperations[topicKey]?.cgo_other_lane,
    ).toMatchObject({ operationId: 'cgo_other_lane' });
  });

  it('cancels a pre-Stop operation that was invisible to the Stop snapshot via its in-flight idempotency key', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const listActive = vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);
    const laneKey = `${messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)}:main`;

    act(() => {
      useChatStore.setState({
        durableInFlightEnqueues: {
          [laneKey]: [{ idempotencyKey: 'chat-send:temp-late', kind: 'chat' }],
        },
      });
    });

    await act(async () => {
      await useChatStore.getState().stopGenerateMessage();
    });

    expect(
      useChatStore.getState().conversationLaneStopMarkers[laneKey]?.stoppedIdempotencyKeys,
    ).toContain('chat-send:temp-late');

    // The pre-Stop operation only becomes visible to the server after the Stop
    // snapshot; sync must cancel it instead of reviving it.
    listActive.mockResolvedValue([
      {
        id: 'cgo_late',
        idempotencyKey: 'chat-send:temp-late',
        kind: 'chat',
        lane: 'lane-late',
        laneGeneration: 1,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        topicId: TEST_IDS.TOPIC_ID,
      },
    ] as any);

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(cancel).toHaveBeenCalledWith('cgo_late');
    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ]?.cgo_late,
    ).toBeUndefined();
  });

  it('attaches a deliberate post-Stop send whose idempotency key was never fenced', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const listActive = vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);
    const laneKey = `${messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)}:main`;

    act(() => {
      useChatStore.setState({
        durableInFlightEnqueues: {
          [laneKey]: [{ idempotencyKey: 'chat-send:temp-late', kind: 'chat' }],
        },
      });
    });

    await act(async () => {
      await useChatStore.getState().stopGenerateMessage();
    });

    listActive.mockResolvedValue([
      {
        id: 'cgo_new_send',
        idempotencyKey: 'chat-send:temp-new',
        kind: 'chat',
        lane: 'lane-late',
        laneGeneration: 2,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        topicId: TEST_IDS.TOPIC_ID,
      },
    ] as any);

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(cancel).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ]?.cgo_new_send,
    ).toMatchObject({ operationId: 'cgo_new_send' });
  });

  it('cancels a relocated auto-topic operation whose source-lane idempotency key was fenced', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const listActive = vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);
    const defaultLaneKey = `${messageMapKey(TEST_IDS.SESSION_ID, null)}:main`;

    act(() => {
      useChatStore.setState({
        activeTopicId: null,
        durableInFlightEnqueues: {
          [defaultLaneKey]: [{ idempotencyKey: 'chat-send:temp-relocate', kind: 'chat' }],
        },
        // The auto-created topic is already in the map when sync runs, so the
        // operation would attach without the idempotency fence.
        topicMaps: { [TEST_IDS.SESSION_ID]: [{ id: 'topic-auto-created' } as any] },
      });
    });

    await act(async () => {
      await useChatStore.getState().stopGenerateMessage();
    });

    // The server auto-created a topic and persisted the operation under the new
    // id; the Stop marker lives on the source (default topic) lane.
    listActive.mockResolvedValue([
      {
        id: 'cgo_relocated',
        idempotencyKey: 'chat-send:temp-relocate',
        kind: 'chat',
        lane: 'lane-relocated',
        laneGeneration: 1,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        topicId: 'topic-auto-created',
      },
    ] as any);

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(cancel).toHaveBeenCalledWith('cgo_relocated');
    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, 'topic-auto-created')
      ]?.cgo_relocated,
    ).toBeUndefined();
  });

  it('chat Stop fences chat-family work but keeps a translation operation applying events', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);
    const { result } = renderHook(() => useChatStore());
    const topicKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);

    act(() => {
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        clearGeneration: 0,
        generation: 0,
        kind: 'chat',
        lane: 'lane-chat',
        operationId: 'cgo_chat',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.attachConversationGeneration({
        clearGeneration: 0,
        generation: 0,
        kind: 'translation',
        lane: 'lane-translation',
        operationId: 'cgo_translation',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
    });

    await act(async () => {
      await result.current.stopGenerateMessage();
    });

    // Chat work is cancelled and detached; the translation survives the Stop.
    expect(cancel).toHaveBeenCalledWith('cgo_chat');
    expect(cancel).not.toHaveBeenCalledWith('cgo_translation');
    expect(useChatStore.getState().serverGenerationOperations[topicKey]?.cgo_chat).toBeUndefined();
    expect(
      useChatStore.getState().serverGenerationOperations[topicKey]?.cgo_translation,
    ).toMatchObject({ operationId: 'cgo_translation' });

    // The lane epoch bump must not suppress the translation's events.
    act(() => {
      result.current.applyConversationGenerationEvent({
        createdAt: new Date().toISOString(),
        id: 1,
        operationId: 'cgo_translation',
        payload: {},
        revision: 3,
        type: 'snapshot',
        userId: 'user-1',
      });
    });

    expect(
      useChatStore.getState().serverGenerationOperations[topicKey]?.cgo_translation?.revision,
    ).toBe(3);
  });

  it('skips sync attach when the loaded topic list is explicitly empty', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([
      {
        id: 'cgo_deleted_topic',
        kind: 'chat',
        lane: 'lane-deleted',
        laneGeneration: 2,
        sessionId: TEST_IDS.SESSION_ID,
        status: 'processing',
        topicId: TEST_IDS.TOPIC_ID,
      },
    ] as any);

    act(() => {
      useChatStore.setState({
        topicMaps: { [TEST_IDS.SESSION_ID]: [] },
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(
      useChatStore.getState().serverGenerationOperations[
        messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
      ]?.cgo_deleted_topic,
    ).toBeUndefined();
  });

  it('uses quiet listActive for scoped cancellation without surfacing fetch errors', async () => {
    const listActive = vi
      .spyOn(conversationGenerationService, 'listActive')
      .mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      await result.current.cancelActiveDurableOpsInScope({
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      });
    });

    expect(listActive).toHaveBeenCalledWith({ quiet: true });
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

  it('deletes an orphaned stale loading placeholder left by an interrupted browser turn', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValueOnce([] as any);
    const internal_deleteMessage = vi.fn(async () => {});
    const refreshMessages = vi.fn(async () => {});
    const refreshTopic = vi.fn(async () => {});

    act(() => {
      useChatStore.setState({
        activeId: TEST_IDS.SESSION_ID,
        activeTopicId: TEST_IDS.TOPIC_ID,
        internal_deleteMessage,
        messagesMap: {
          [messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)]: [
            {
              content: LOADING_FLAT,
              createdAt: Date.now() - 10 * 60 * 1000,
              id: 'assistant-orphan',
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

    expect(internal_deleteMessage).toHaveBeenCalledWith('assistant-orphan');
    expect(refreshMessages).toHaveBeenCalled();
  });

  it('keeps a fresh loading placeholder that a live producer may still finalize', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValueOnce([] as any);
    const internal_deleteMessage = vi.fn(async () => {});

    act(() => {
      useChatStore.setState({
        activeId: TEST_IDS.SESSION_ID,
        activeTopicId: TEST_IDS.TOPIC_ID,
        internal_deleteMessage,
        messagesMap: {
          [messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)]: [
            {
              content: LOADING_FLAT,
              createdAt: Date.now(),
              id: 'assistant-fresh',
              role: 'assistant',
            },
          ],
        },
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(internal_deleteMessage).not.toHaveBeenCalled();
  });

  it('keeps a stale placeholder while its browser turn is still loading in this tab', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValueOnce([] as any);
    const internal_deleteMessage = vi.fn(async () => {});

    act(() => {
      useChatStore.setState({
        activeId: TEST_IDS.SESSION_ID,
        activeTopicId: TEST_IDS.TOPIC_ID,
        chatLoadingIds: ['assistant-busy'],
        internal_deleteMessage,
        messagesMap: {
          [messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)]: [
            {
              content: LOADING_FLAT,
              createdAt: Date.now() - 10 * 60 * 1000,
              id: 'assistant-busy',
              role: 'assistant',
            },
          ],
        },
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(internal_deleteMessage).not.toHaveBeenCalled();
  });

  it('keeps a leftover LOADING_FLAT deferred placeholder instead of blanking it into a white circle', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValueOnce([] as any);
    const internal_deleteMessage = vi.fn(async () => {});
    const refreshMessages = vi.fn(async () => {});
    const refreshTopic = vi.fn(async () => {});
    const conversationKey = deferredBrowserGenerationLaneKey(
      TEST_IDS.SESSION_ID,
      TEST_IDS.TOPIC_ID,
      null,
    );
    const mapKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);

    act(() => {
      useChatStore.setState({
        activeId: TEST_IDS.SESSION_ID,
        activeTopicId: TEST_IDS.TOPIC_ID,
        deferredBrowserGenerationLanes: {
          [conversationKey]: {
            assistantMessageId: 'assistant-deferred',
            reason: 'unsupported_tool',
            toolName: 'lobe-image-designer',
          },
        },
        internal_deleteMessage,
        messagesMap: {
          [mapKey]: [
            {
              content: LOADING_FLAT,
              createdAt: Date.now(),
              id: 'assistant-deferred',
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

    expect(internal_deleteMessage).not.toHaveBeenCalled();
    expect(useChatStore.getState().deferredBrowserGenerationLanes[conversationKey]).toEqual(
      expect.objectContaining({ assistantMessageId: 'assistant-deferred' }),
    );
    expect(useChatStore.getState().chatLoadingIds).not.toContain('assistant-deferred');
  });

  it('clears the deferred marker after persist already wrote non-LOADING_FLAT content', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValueOnce([] as any);
    const conversationKey = deferredBrowserGenerationLaneKey(
      TEST_IDS.SESSION_ID,
      TEST_IDS.TOPIC_ID,
      null,
    );
    const mapKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);

    act(() => {
      useChatStore.setState({
        activeId: TEST_IDS.SESSION_ID,
        activeTopicId: TEST_IDS.TOPIC_ID,
        deferredBrowserGenerationLanes: {
          [conversationKey]: {
            assistantMessageId: 'assistant-deferred',
            reason: 'unsupported_tool',
            toolName: 'lobe-code-interpreter',
          },
        },
        messagesMap: {
          [mapKey]: [
            {
              content: 'persisted reply',
              createdAt: Date.now(),
              id: 'assistant-deferred',
              role: 'assistant',
            },
          ],
        },
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(useChatStore.getState().deferredBrowserGenerationLanes[conversationKey]).toBeUndefined();
  });

  it('resumes triggerToolCalls on switch-back when the deferred row has tools and no results', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValueOnce([] as any);
    const triggerToolCalls = vi.fn(async () => {});
    const conversationKey = deferredBrowserGenerationLaneKey(
      TEST_IDS.SESSION_ID,
      TEST_IDS.TOPIC_ID,
      null,
    );
    const mapKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);

    act(() => {
      useChatStore.setState({
        activeId: TEST_IDS.SESSION_ID,
        activeTopicId: TEST_IDS.TOPIC_ID,
        deferredBrowserGenerationLanes: {
          [conversationKey]: {
            assistantMessageId: 'assistant-deferred',
            reason: 'unsupported_tool',
            toolName: 'lobe-code-interpreter',
          },
        },
        messagesMap: {
          [mapKey]: [
            {
              content: '',
              createdAt: Date.now(),
              id: 'assistant-deferred',
              role: 'assistant',
              tools: [{ id: 'call-1', identifier: 'lobe-code-interpreter', type: 'builtin' }],
            },
          ],
        },
        triggerToolCalls,
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(triggerToolCalls).toHaveBeenCalledWith(
      'assistant-deferred',
      expect.objectContaining({ threadId: undefined }),
    );
  });

  it('emits deferred_lane_resumed with resume_tools on switch-back', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValueOnce([] as any);
    const logSpy = vi.spyOn(generationDebugClient, 'logDeferredGenerationLane').mockResolvedValue();
    const triggerToolCalls = vi.fn(async () => {});
    const conversationKey = deferredBrowserGenerationLaneKey(
      TEST_IDS.SESSION_ID,
      TEST_IDS.TOPIC_ID,
      null,
    );
    const mapKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);

    act(() => {
      useChatStore.setState({
        activeId: TEST_IDS.SESSION_ID,
        activeTopicId: TEST_IDS.TOPIC_ID,
        deferredBrowserGenerationLanes: {
          [conversationKey]: {
            assistantMessageId: 'assistant-deferred',
            reason: 'unsupported_tool',
            spanId: 'gd_0123456789abcdef',
            toolName: 'lobe-code-interpreter',
          },
        },
        messagesMap: {
          [mapKey]: [
            {
              content: '',
              createdAt: Date.now(),
              id: 'assistant-deferred',
              role: 'assistant',
              tools: [{ id: 'call-1', identifier: 'lobe-code-interpreter', type: 'builtin' }],
            },
          ],
        },
        triggerToolCalls,
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations({ reason: 'topic_change' });
    });

    expect(logSpy).toHaveBeenCalledWith(
      'deferred_lane_resumed',
      expect.objectContaining({
        outcome: 'resume_tools',
        spanId: 'gd_0123456789abcdef',
        toolName: 'lobe-code-interpreter',
      }),
    );
  });

  it('emits deferred_lane_resumed with resume_model when tools already have results', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValueOnce([] as any);
    const logSpy = vi.spyOn(generationDebugClient, 'logDeferredGenerationLane').mockResolvedValue();
    const triggerAIMessage = vi.fn(async () => {});
    const conversationKey = deferredBrowserGenerationLaneKey(
      TEST_IDS.SESSION_ID,
      TEST_IDS.TOPIC_ID,
      null,
    );
    const mapKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);

    act(() => {
      useChatStore.setState({
        activeId: TEST_IDS.SESSION_ID,
        activeTopicId: TEST_IDS.TOPIC_ID,
        deferredBrowserGenerationLanes: {
          [conversationKey]: {
            assistantMessageId: 'assistant-deferred',
            reason: 'unsupported_tool',
            spanId: 'gd_0123456789abcdef',
            toolName: 'lobe-image-designer',
          },
        },
        messagesMap: {
          [mapKey]: [
            {
              content: 'searching',
              createdAt: Date.now(),
              id: 'assistant-deferred',
              role: 'assistant',
              tools: [{ id: 'call-1', identifier: 'tavily', type: 'mcp' }],
            },
            {
              content: '{"ok":true}',
              createdAt: Date.now(),
              id: 'tool-deferred',
              parentId: 'assistant-deferred',
              role: 'tool',
            },
          ],
        },
        triggerAIMessage,
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations({ reason: 'topic_change' });
    });

    expect(triggerAIMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.objectContaining({
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        }),
        parentId: 'tool-deferred',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      'deferred_lane_resumed',
      expect.objectContaining({
        outcome: 'resume_model',
        spanId: 'gd_0123456789abcdef',
      }),
    );
  });

  it('emits deferred_lane_left for a live producer without clearing the marker', () => {
    const logSpy = vi.spyOn(generationDebugClient, 'logDeferredGenerationLane').mockResolvedValue();
    const conversationKey = deferredBrowserGenerationLaneKey(
      TEST_IDS.SESSION_ID,
      TEST_IDS.TOPIC_ID,
      null,
    );

    act(() => {
      useChatStore.setState({
        activeId: TEST_IDS.SESSION_ID,
        activeTopicId: TEST_IDS.TOPIC_ID,
        chatLoadingIds: ['assistant-deferred'],
        deferredBrowserGenerationLanes: {
          [conversationKey]: {
            assistantMessageId: 'assistant-deferred',
            reason: 'unsupported_tool',
            spanId: 'gd_0123456789abcdef',
            toolName: 'lobe-code-interpreter',
          },
        },
      });
    });

    act(() => {
      useChatStore.getState().internal_notifyDeferredLanesLeft({
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        type: 'navigation',
      });
    });

    expect(logSpy).toHaveBeenCalledWith(
      'deferred_lane_left',
      expect.objectContaining({
        producerAlive: true,
        spanId: 'gd_0123456789abcdef',
        type: 'navigation',
      }),
    );
    expect(useChatStore.getState().deferredBrowserGenerationLanes[conversationKey]).toBeDefined();
  });

  it('emits deferred_lane_aborted when a topic delete clears deferred lanes', () => {
    const logSpy = vi.spyOn(generationDebugClient, 'logDeferredGenerationLane').mockResolvedValue();
    const conversationKey = deferredBrowserGenerationLaneKey(
      TEST_IDS.SESSION_ID,
      TEST_IDS.TOPIC_ID,
      null,
    );

    act(() => {
      useChatStore.setState({
        activeId: TEST_IDS.SESSION_ID,
        activeTopicId: TEST_IDS.TOPIC_ID,
        deferredBrowserGenerationLanes: {
          [conversationKey]: {
            assistantMessageId: 'assistant-deferred',
            reason: 'unsupported_tool',
            spanId: 'gd_0123456789abcdef',
            toolName: 'lobe-code-interpreter',
          },
        },
      });
    });

    act(() => {
      useChatStore.getState().internal_abortDeferredBrowserLanesForTopic(
        TEST_IDS.SESSION_ID,
        TEST_IDS.TOPIC_ID,
        'topic_delete',
      );
    });

    expect(logSpy).toHaveBeenCalledWith(
      'deferred_lane_aborted',
      expect.objectContaining({
        spanId: 'gd_0123456789abcdef',
        type: 'topic_delete',
      }),
    );
    expect(useChatStore.getState().deferredBrowserGenerationLanes[conversationKey]).toBeUndefined();
  });

  it('does not finalize a deferred placeholder while its browser producer is still loading', async () => {
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValueOnce([] as any);
    const refreshMessages = vi.fn(async () => {});
    const conversationKey = deferredBrowserGenerationLaneKey(
      TEST_IDS.SESSION_ID,
      TEST_IDS.TOPIC_ID,
      null,
    );
    const mapKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);

    act(() => {
      useChatStore.setState({
        activeId: TEST_IDS.SESSION_ID,
        activeTopicId: TEST_IDS.TOPIC_ID,
        chatLoadingIds: ['assistant-deferred'],
        deferredBrowserGenerationLanes: {
          [conversationKey]: {
            assistantMessageId: 'assistant-deferred',
            reason: 'unsupported_tool',
            toolName: 'lobe-code-interpreter',
          },
        },
        messagesMap: {
          [mapKey]: [
            {
              content: LOADING_FLAT,
              createdAt: Date.now(),
              id: 'assistant-deferred',
              role: 'assistant',
            },
          ],
        },
        refreshMessages,
      });
    });

    await act(async () => {
      await useChatStore.getState().syncActiveConversationGenerations();
    });

    expect(useChatStore.getState().deferredBrowserGenerationLanes[conversationKey]).toEqual(
      expect.objectContaining({ assistantMessageId: 'assistant-deferred' }),
    );
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
