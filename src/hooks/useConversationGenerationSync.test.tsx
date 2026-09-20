import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { conversationGenerationService } from '@/services/conversationGeneration';
import { useChatStore } from '@/store/chat';
import * as eventDroppedDebug from '@/store/chat/slices/aiChat/actions/eventDroppedDebug';
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
    vi.spyOn(eventDroppedDebug, 'flushEventDropSummary');
    vi.spyOn(eventDroppedDebug, 'resetEventDroppedDebugState');
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
    expect(eventDroppedDebug.resetEventDroppedDebugState).toHaveBeenCalled();
    unmount();
  });

  it('resyncs and reconnects when the tab becomes visible', async () => {
    const syncActive = vi.fn(async () => {});
    useChatStore.setState({ syncActiveConversationGenerations: syncActive });
    const { unmount } = renderHook(() => useConversationGenerationSync());

    await waitFor(() => {
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(1);
    });
    const syncAfterMount = syncActive.mock.calls.length;

    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(syncActive.mock.calls.length).toBeGreaterThan(syncAfterMount);
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(2);
    });
    unmount();
  });

  it('resyncs and reconnects on persisted pageshow', async () => {
    const syncActive = vi.fn(async () => {});
    useChatStore.setState({ syncActiveConversationGenerations: syncActive });
    const { unmount } = renderHook(() => useConversationGenerationSync());

    await waitFor(() => {
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(1);
    });
    const syncAfterMount = syncActive.mock.calls.length;

    act(() => {
      const event = new Event('pageshow');
      Object.defineProperty(event, 'persisted', { value: true });
      window.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(syncActive.mock.calls.length).toBeGreaterThan(syncAfterMount);
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(2);
    });
    unmount();
  });

  it('does not treat first-load pageshow without persisted as resume', async () => {
    const syncActive = vi.fn(async () => {});
    useChatStore.setState({ syncActiveConversationGenerations: syncActive });
    const { unmount } = renderHook(() => useConversationGenerationSync());

    await waitFor(() => {
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(1);
    });
    const syncAfterMount = syncActive.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(syncActive.mock.calls.length).toBe(syncAfterMount);
    expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(1);
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

  it('resyncs on reset without replaying from cursor zero', async () => {
    const applyEvent = vi.fn();
    const syncActive = vi.fn(async () => {});
    useChatStore.setState({
      applyConversationGenerationEvent: applyEvent,
      syncActiveConversationGenerations: syncActive,
    });

    const { unmount } = renderHook(() => useConversationGenerationSync());
    await waitFor(() => {
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(1);
    });

    const subscription = vi.mocked(conversationGenerationService.subscribe).mock.calls[0][0];
    subscription.onEvent({ cursor: 12, reset: true, type: 'reset' });

    await waitFor(() => {
      expect(syncActive.mock.calls.length).toBeGreaterThan(0);
    });
    expect(conversationGenerationService.listEvents).not.toHaveBeenCalled();
    expect(applyEvent).not.toHaveBeenCalled();
    expect(eventDroppedDebug.flushEventDropSummary).toHaveBeenCalled();
    unmount();

    renderHook(() => useConversationGenerationSync());
    await waitFor(() => {
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(conversationGenerationService.subscribe).mock.calls[1][0].cursor).toBe(12);
  });

  it.each([
    [100, 101],
    [0, 1],
  ])(
    'does not overwrite delivered cursor %s -> %s when reset sync finishes late',
    async (resetCursor, deliveredCursor) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const syncActive = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => gate)
        .mockResolvedValue(undefined);
      useChatStore.setState({
        applyConversationGenerationEvent: vi.fn(),
        syncActiveConversationGenerations: syncActive,
      });
      const userId = `reset-cursor-user-${resetCursor}`;
      useUserStore.setState({ user: { id: userId } as any });

      const first = renderHook(() => useConversationGenerationSync());
      await waitFor(() => {
        expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(1);
      });

      const subscription = vi.mocked(conversationGenerationService.subscribe).mock.calls[0][0];
      act(() => {
        subscription.onEvent({ cursor: resetCursor, reset: true, type: 'reset' });
        subscription.onEvent({
          createdAt: new Date().toISOString(),
          id: deliveredCursor,
          operationId: 'operation-later',
          payload: {},
          revision: 1,
          type: 'done',
          userId,
        });
      });

      await act(async () => {
        release();
        await gate;
      });
      first.unmount();

      renderHook(() => useConversationGenerationSync());
      await waitFor(() => {
        expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(2);
      });
      expect(vi.mocked(conversationGenerationService.subscribe).mock.calls[1][0].cursor).toBe(
        deliveredCursor,
      );
    },
  );

  it('does not rewind the cursor when reset omits cursor', async () => {
    const { unmount } = renderHook(() => useConversationGenerationSync());
    await waitFor(() => {
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(1);
    });

    const subscription = vi.mocked(conversationGenerationService.subscribe).mock.calls[0][0];
    subscription.onEvent({
      createdAt: new Date().toISOString(),
      id: 9,
      operationId: 'operation-1',
      payload: {},
      revision: 1,
      type: 'status',
      userId: 'user-a',
    });
    subscription.onEvent({ reset: true, type: 'reset' });

    await waitFor(() => {
      expect(useChatStore.getState().syncActiveConversationGenerations).toHaveBeenCalled();
    });
    unmount();

    renderHook(() => useConversationGenerationSync());
    await waitFor(() => {
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(conversationGenerationService.subscribe).mock.calls[1][0].cursor).toBe(9);
  });

  it('reconnects SSE after the stream ends instead of staying on poll-only', async () => {
    vi.mocked(conversationGenerationService.subscribe)
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(() => new Promise(() => {}));

    const { unmount } = renderHook(() => useConversationGenerationSync());

    await waitFor(() => {
      expect(conversationGenerationService.subscribe).toHaveBeenCalledTimes(2);
    });
    expect(eventDroppedDebug.flushEventDropSummary).toHaveBeenCalled();
    unmount();
  });
});
