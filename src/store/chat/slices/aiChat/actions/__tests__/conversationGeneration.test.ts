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
        generation: 0,
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
        generation: 0,
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
  });

  it('clears supervisor loading and detaches on done', () => {
    const { result } = renderHook(() => useChatStore());
    const toggleSupervisor = vi.fn();

    act(() => {
      useChatStore.setState({ internal_toggleSupervisorLoading: toggleSupervisor });
      result.current.attachConversationGeneration({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        generation: 0,
        groupId: 'group-1',
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
        generation: 0,
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

  it('detaches operations after stop', async () => {
    const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.attachConversationGeneration({
        generation: 0,
        operationId: 'cgo_active',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.stopDurableConversationGeneration();
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

    act(() => {
      result.current.attachConversationGeneration({
        generation: 0,
        operationId: 'cgo_active',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.attachConversationGeneration({
        generation: 0,
        operationId: 'cgo_other',
        sessionId: 'other-session',
        topicId: TEST_IDS.TOPIC_ID,
        userScope: 'current',
      });
      result.current.stopDurableConversationGeneration();
    });

    expect(cancel).toHaveBeenCalledWith('cgo_active');
    expect(cancel).not.toHaveBeenCalledWith('cgo_other');
  });
});
