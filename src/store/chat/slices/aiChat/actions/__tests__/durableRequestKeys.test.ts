import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';

import { useChatStore } from '../../../../store';
import { createMockMessage } from './fixtures';
import { setupMockSelectors, setupStoreWithMessages, spyOnMessageService } from './helpers';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/helpers/durableConversationGeneration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/helpers/durableConversationGeneration')>()),
  isClientDurableConversationGenerationEnabled: vi.fn(() => true),
}));

describe('durable request keys', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
    vi.spyOn(messageService, 'getConversationVersion').mockResolvedValue(7);
    spyOnMessageService();
    setupMockSelectors();
    useUserStore.setState({ ownershipInvalidationGeneration: 0 });
    act(() => {
      useSessionStore.setState({ activeId: 'group-1' });
      useChatStore.setState({
        activeId: 'group-1',
        activeTopicId: 'topic-1',
        attachConversationGeneration: vi.fn(),
        conversationClearGeneration: 0,
        internal_toggleSupervisorLoading: vi.fn(),
        messagesMap: {
          [messageMapKey('group-1', 'topic-1')]: [
            createMockMessage({ content: 'hello', id: 'user-1', role: 'user' }),
          ],
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a new durable request key for each supervisor decision in the same group topic', async () => {
    const enqueue = vi.spyOn(conversationGenerationService, 'enqueue').mockImplementation(
      async (input: any) =>
        ({
          id: `cgo-${input.idempotencyKey}`,
          kind: 'group_supervisor',
          lane: 'lane-supervisor',
          laneGeneration: 1,
          revision: 1,
        }) as any,
    );
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      await result.current.internal_triggerSupervisorDecision('group-1', 'topic-1', true, 7);
    });
    await act(async () => {
      await result.current.internal_triggerSupervisorDecision('group-1', 'topic-1', true, 7);
    });

    expect(enqueue).toHaveBeenCalledTimes(2);
    const keys = enqueue.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys[0]).not.toEqual(keys[1]);
    expect(keys[0]).toContain('group-supervisor');
    expect(keys[1]).toContain('group-supervisor');
  });

  it('uses a new durable request key for each regenerate of the same source message', async () => {
    const enqueue = vi.spyOn(conversationGenerationService, 'enqueue').mockImplementation(
      async (input: any) =>
        ({
          assistantMessageId: `asst-${input.idempotencyKey}`,
          id: `cgo-${input.idempotencyKey}`,
          kind: 'regenerate',
          lane: 'lane-regenerate',
          laneGeneration: 1,
          revision: 1,
        }) as any,
    );
    const user = createMockMessage({ id: 'user-1', role: 'user' });
    const assistant = createMockMessage({
      id: 'assistant-1',
      parentId: user.id,
      role: 'assistant',
    });
    act(() => {
      setupStoreWithMessages([user, assistant]);
      useChatStore.setState({
        activeTopicId: undefined,
        attachConversationGeneration: vi.fn(),
      });
    });
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      await result.current.internal_resendMessage(assistant.id);
    });
    await act(async () => {
      await result.current.internal_resendMessage(user.id);
    });

    expect(enqueue).toHaveBeenCalledTimes(2);
    const keys = enqueue.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys[0]).not.toEqual(keys[1]);
    expect(keys[0]).toContain('regenerate');
    expect(keys[1]).toContain('regenerate');
  });

  it('omits a null activeThreadId from regenerate enqueue so Zod does not reject JSON null', async () => {
    const enqueue = vi.spyOn(conversationGenerationService, 'enqueue').mockImplementation(
      async (input: any) =>
        ({
          assistantMessageId: `asst-${input.idempotencyKey}`,
          id: `cgo-${input.idempotencyKey}`,
          kind: 'regenerate',
          lane: 'lane-regenerate',
          laneGeneration: 1,
          revision: 1,
        }) as any,
    );
    const user = createMockMessage({ id: 'user-1', role: 'user' });
    const assistant = createMockMessage({
      id: 'assistant-1',
      parentId: user.id,
      role: 'assistant',
    });
    act(() => {
      setupStoreWithMessages([user, assistant]);
      useChatStore.setState({
        activeThreadId: null,
        activeTopicId: undefined,
        attachConversationGeneration: vi.fn(),
      });
    });
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      await result.current.internal_resendMessage(assistant.id);
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0].threadId).toBeUndefined();
  });

  it('never enqueues a supervisor decision when its topic is deleted during the version lookup', async () => {
    const enqueue = vi.spyOn(conversationGenerationService, 'enqueue').mockResolvedValue({} as any);
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);
    vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    vi.spyOn(messageService, 'removeMessagesByAssistant').mockResolvedValue(undefined);
    vi.spyOn(topicService, 'removeTopic').mockResolvedValue(undefined);
    let resolveVersion!: (version: number) => void;
    vi.spyOn(messageService, 'getConversationVersion').mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveVersion = resolve;
        }),
    );
    act(() => {
      useChatStore.setState({
        // Keep the active topic id unchanged so only the topic-scoped
        // tombstone can reject the enqueue (removeTopic never bumps the global
        // clear epoch).
        refreshTopic: vi.fn(async () => {}),
        switchTopic: vi.fn(),
      });
    });
    const { result } = renderHook(() => useChatStore());

    const decisionPromise = result.current.internal_triggerSupervisorDecision(
      'group-1',
      'topic-1',
      true,
    );
    await vi.waitFor(() => {
      expect(messageService.getConversationVersion).toHaveBeenCalled();
    });

    const removePromise = result.current.removeTopic('topic-1');
    resolveVersion(7);
    await decisionPromise;
    await removePromise;

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('never enqueues a regenerate when its topic is deleted during the version lookup', async () => {
    const enqueue = vi.spyOn(conversationGenerationService, 'enqueue').mockResolvedValue({} as any);
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);
    vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
    vi.spyOn(messageService, 'removeMessagesByAssistant').mockResolvedValue(undefined);
    vi.spyOn(topicService, 'removeTopic').mockResolvedValue(undefined);
    const user = createMockMessage({ id: 'user-1', role: 'user' });
    const assistant = createMockMessage({
      id: 'assistant-1',
      parentId: user.id,
      role: 'assistant',
    });
    act(() => {
      useChatStore.setState({
        activeTopicId: 'topic-1',
        attachConversationGeneration: vi.fn(),
        messagesMap: {
          [messageMapKey('group-1', 'topic-1')]: [user, assistant],
        },
        refreshTopic: vi.fn(async () => {}),
        switchTopic: vi.fn(),
      });
    });
    let resolveVersion!: (version: number) => void;
    vi.spyOn(messageService, 'getConversationVersion').mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveVersion = resolve;
        }),
    );
    const { result } = renderHook(() => useChatStore());

    const retryPromise = result.current.internal_resendMessage(assistant.id);
    await vi.waitFor(() => {
      expect(messageService.getConversationVersion).toHaveBeenCalled();
    });

    const removePromise = result.current.removeTopic('topic-1');
    resolveVersion(7);
    await retryPromise;
    await removePromise;

    expect(enqueue).not.toHaveBeenCalled();
  });
});
