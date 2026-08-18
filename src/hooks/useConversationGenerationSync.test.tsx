import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { conversationGenerationService } from '@/services/conversationGeneration';
import { useChatStore } from '@/store/chat';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';

import { useConversationGenerationSync } from './useConversationGenerationSync';

vi.mock('@/helpers/durableConversationGeneration', () => ({
  isClientDurableConversationGenerationEnabled: vi.fn(() => true),
}));

vi.mock('@/services/conversationGeneration', () => ({
  conversationGenerationService: {
    listEvents: vi.fn(async () => ({ cursor: 0, events: [], reset: false })),
    subscribe: vi.fn(),
  },
}));

describe('useConversationGenerationSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(conversationGenerationService.subscribe).mockImplementation(
      () => new Promise(() => {}),
    );
    useSessionStore.setState({ activeId: 'session-1' });
    useChatStore.setState({
      activeTopicId: 'topic-1',
      activeThreadId: undefined,
      portalThreadId: undefined,
      syncActiveConversationGenerations: vi.fn(async () => {}),
    });
    useUserStore.setState({ user: { id: 'user-a' } as any });
  });

  afterEach(() => {
    useUserStore.setState({ user: undefined });
  });

  it('starts a returning user from cursor zero after account changes', async () => {
    const { unmount } = renderHook(() => useConversationGenerationSync());

    await waitFor(() => {
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(1);
    });
    const firstSubscription = vi.mocked(conversationGenerationService.subscribe).mock.calls[0][0];
    firstSubscription.onEvent({
      createdAt: new Date().toISOString(),
      id: 9,
      operationId: 'operation-1',
      payload: {},
      revision: 1,
      type: 'status',
      userId: 'user-a',
    });

    act(() => {
      useUserStore.setState({ user: { id: 'user-b' } as any });
    });
    await waitFor(() => {
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(2);
    });

    act(() => {
      useUserStore.setState({ user: { id: 'user-a' } as any });
    });
    await waitFor(() => {
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(3);
    });

    expect(vi.mocked(conversationGenerationService.subscribe).mock.calls[2][0].cursor).toBe(0);
    unmount();
  });

  it('resyncs when the visible portal thread changes', async () => {
    const syncActive = vi.fn(async () => {});
    useChatStore.setState({ syncActiveConversationGenerations: syncActive });
    const { unmount } = renderHook(() => useConversationGenerationSync());

    await waitFor(() => {
      expect(syncActive).toHaveBeenCalled();
    });
    const callsAfterMount = syncActive.mock.calls.length;

    act(() => {
      useChatStore.setState({ portalThreadId: 'thread-1' });
    });

    await waitFor(() => {
      expect(syncActive.mock.calls.length).toBeGreaterThan(callsAfterMount);
    });
    unmount();
  });
});
