import { act, render, waitFor } from '@testing-library/react';
import React, { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';

import SessionHydration from './SessionHydration';

const { queryStateStore, setSessionMock } = vi.hoisted(() => {
  let querySession = 'inbox';
  const listeners = new Set<() => void>();

  return {
    queryStateStore: {
      getSnapshot: () => querySession,
      setQuerySession: (sessionId: string) => {
        querySession = sessionId;
        listeners.forEach((listener) => listener());
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    setSessionMock: vi.fn(async () => new URLSearchParams()),
  };
});

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('nuqs', () => ({
  throttle: (timeMs: number) => ({ method: 'throttle', timeMs }),
  useQueryState: () => [
    useSyncExternalStore(
      queryStateStore.subscribe,
      queryStateStore.getSnapshot,
      queryStateStore.getSnapshot,
    ),
    setSessionMock,
  ],
}));

const assistantSession = {
  id: 'assistant-a',
  meta: { title: 'Assistant A' },
};
const accountBAssistantSession = {
  id: 'assistant-b',
  meta: { title: 'Assistant B' },
};

const setVerifiedAccount = (accountId = 'account-a') => {
  useUserStore.setState({
    authUserId: accountId,
    isLoaded: true,
    isSignedIn: true,
    isUserStateInit: true,
    user: { id: accountId },
    userStateInitializationFailure: undefined,
    userStateScope: `user:${accountId}`,
  });
};

describe('SessionHydration', () => {
  beforeEach(() => {
    setSessionMock.mockClear();
    queryStateStore.setQuerySession('inbox');
    setVerifiedAccount();
    useSessionStore.setState({
      activeId: 'inbox',
      isSessionsFirstFetchFinished: false,
      sessions: [],
    });
    useAgentStore.setState({ activeId: 'inbox' });
    useChatStore.setState({
      activeId: 'inbox',
      internal_updateActiveId: vi.fn((activeId: string) => {
        useChatStore.setState({ activeId });
      }),
      switchTopic: vi.fn(async () => undefined),
    });
  });

  it('waits for session-list readiness before hydrating a valid deep link', async () => {
    queryStateStore.setQuerySession('assistant-a');
    render(<SessionHydration />);

    expect(useSessionStore.getState().activeId).toBe('inbox');
    expect(setSessionMock).not.toHaveBeenCalled();

    act(() => {
      useSessionStore.setState({
        isSessionsFirstFetchFinished: true,
        sessions: [assistantSession] as any,
      });
    });

    await waitFor(() => {
      expect(useSessionStore.getState().activeId).toBe('assistant-a');
    });
    expect(useAgentStore.getState().activeId).toBe('assistant-a');
    expect(useChatStore.getState().activeId).toBe('assistant-a');
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('does not replay topic switching for an already-active valid deep link', () => {
    queryStateStore.setQuerySession('assistant-a');
    useSessionStore.setState({
      activeId: 'assistant-a',
      isSessionsFirstFetchFinished: true,
      sessions: [assistantSession] as any,
    });

    render(<SessionHydration />);

    expect(useAgentStore.getState().activeId).toBe('assistant-a');
    expect(useChatStore.getState().activeId).toBe('assistant-a');
    expect(useChatStore.getState().switchTopic).not.toHaveBeenCalled();
  });

  it('normalizes a missing assistant only after session initialization confirms it', async () => {
    queryStateStore.setQuerySession('stale-assistant');
    render(<SessionHydration />);

    expect(setSessionMock).not.toHaveBeenCalled();

    act(() => {
      useSessionStore.setState({
        isSessionsFirstFetchFinished: true,
        sessions: [assistantSession] as any,
      });
    });

    await waitFor(() => {
      expect(setSessionMock).toHaveBeenCalledOnce();
    });
    expect(setSessionMock).toHaveBeenCalledWith('inbox');
    expect(useSessionStore.getState().activeId).toBe('inbox');
  });

  it('keeps inbox available while authenticated ownership is unresolved', () => {
    useUserStore.setState({
      authUserId: undefined,
      isLoaded: false,
      isSignedIn: true,
      isUserStateInit: false,
      user: undefined,
      userStateScope: undefined,
    });
    queryStateStore.setQuerySession('inbox');

    render(<SessionHydration />);

    expect(useSessionStore.getState().activeId).toBe('inbox');
    expect(useAgentStore.getState().activeId).toBe('inbox');
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('prevents a stale query from reviving an assistant after account invalidation', async () => {
    queryStateStore.setQuerySession('assistant-a');
    useSessionStore.setState({
      isSessionsFirstFetchFinished: true,
      sessions: [assistantSession] as any,
    });
    render(<SessionHydration />);

    await waitFor(() => {
      expect(useSessionStore.getState().activeId).toBe('assistant-a');
    });

    act(() => {
      useUserStore.setState({
        isUserStateInit: false,
        userStateScope: undefined,
      });
      useSessionStore.getState().switchSession('inbox');
    });

    expect(useSessionStore.getState().activeId).toBe('inbox');
    expect(setSessionMock).toHaveBeenCalledWith('inbox');

    act(() => {
      setVerifiedAccount();
    });

    expect(useSessionStore.getState().activeId).toBe('inbox');
    expect(setSessionMock).toHaveBeenCalledOnce();
  });

  it('falls back to inbox when ownership is confirmed for a different account', async () => {
    queryStateStore.setQuerySession('assistant-a');
    useSessionStore.setState({
      isSessionsFirstFetchFinished: true,
      sessions: [assistantSession] as any,
    });
    const { rerender } = render(<SessionHydration />);

    await waitFor(() => {
      expect(useSessionStore.getState().activeId).toBe('assistant-a');
    });

    act(() => {
      useUserStore.setState({
        authUserId: undefined,
        isLoaded: false,
        isSignedIn: true,
        isUserStateInit: false,
        user: undefined,
        userStateScope: undefined,
      });
    });
    rerender(<SessionHydration />);

    act(() => {
      setVerifiedAccount('account-b');
    });

    await waitFor(() => {
      expect(useSessionStore.getState().activeId).toBe('inbox');
    });
    expect(setSessionMock).toHaveBeenCalledWith('inbox');

    act(() => {
      queryStateStore.setQuerySession('inbox');
      useSessionStore.setState({
        isSessionsFirstFetchFinished: true,
        sessions: [accountBAssistantSession] as any,
      });
      queryStateStore.setQuerySession('assistant-b');
    });

    await waitFor(() => {
      expect(useSessionStore.getState().activeId).toBe('assistant-b');
    });
  });

  it('accepts the first valid assistant after an account switch completed on inbox', async () => {
    render(<SessionHydration />);

    act(() => {
      useUserStore.setState({
        authUserId: undefined,
        isLoaded: false,
        isSignedIn: true,
        isUserStateInit: false,
        user: undefined,
        userStateScope: undefined,
      });
    });

    act(() => {
      setVerifiedAccount('account-b');
      useSessionStore.setState({
        isSessionsFirstFetchFinished: true,
        sessions: [accountBAssistantSession] as any,
      });
    });

    act(() => {
      queryStateStore.setQuerySession('assistant-b');
    });

    await waitFor(() => {
      expect(useSessionStore.getState().activeId).toBe('assistant-b');
    });
    expect(setSessionMock).not.toHaveBeenCalled();
  });
});
