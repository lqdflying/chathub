import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
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
});
