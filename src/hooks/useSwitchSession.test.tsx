import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { useSessionStore } from '@/store/session';
import { getAssistantHydrationCancellationGeneration } from '@/store/session/hydrationIntent';
import { useUserStore } from '@/store/user';

import { useSwitchSession } from './useSwitchSession';

const { pushMock, serverConfigState } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  serverConfigState: { isMobile: true },
}));

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({ push: pushMock }),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: typeof serverConfigState) => unknown) =>
    selector(serverConfigState),
}));

const assistantSession = {
  id: 'assistant-a',
  meta: { title: 'Assistant A' },
};

const setVerifiedAccount = () => {
  useUserStore.setState({
    authUserId: 'account-a',
    isLoaded: true,
    isSignedIn: true,
    isUserStateInit: true,
    user: { id: 'account-a' },
    userStateInitializationFailure: undefined,
    userStateScope: 'user:account-a',
  });
};

describe('useSwitchSession', () => {
  beforeEach(() => {
    pushMock.mockReset();
    serverConfigState.isMobile = true;
    setVerifiedAccount();
    useSessionStore.setState({
      activeId: 'inbox',
      isSessionsFirstFetchFinished: true,
      sessions: [assistantSession] as any,
    });
    useChatStore.setState({
      showPortal: true,
      togglePortal: vi.fn(),
    });
  });

  it('routes a valid mobile assistant without eagerly changing the active session', () => {
    const { result } = renderHook(() => useSwitchSession());

    let didSwitchSession = false;
    act(() => {
      didSwitchSession = result.current('assistant-a');
    });

    expect(didSwitchSession).toBe(true);
    expect(useSessionStore.getState().activeId).toBe('inbox');
    expect(useChatStore.getState().togglePortal).toHaveBeenCalledWith(false);
    expect(pushMock).toHaveBeenCalledOnce();
    expect(pushMock).toHaveBeenCalledWith('/chat', {
      query: { session: 'assistant-a', showMobileWorkspace: 'true' },
    });
  });

  it('routes an already-active assistant exactly once', () => {
    useSessionStore.setState({ activeId: 'assistant-a' });
    const { result } = renderHook(() => useSwitchSession());

    act(() => {
      expect(result.current('assistant-a')).toBe(true);
    });

    expect(useSessionStore.getState().activeId).toBe('assistant-a');
    expect(pushMock).toHaveBeenCalledOnce();
  });

  it('allows inbox navigation while authenticated ownership is unresolved', () => {
    useUserStore.setState({
      authUserId: undefined,
      isLoaded: false,
      isSignedIn: true,
      isUserStateInit: false,
      user: undefined,
      userStateScope: undefined,
    });
    useSessionStore.setState({
      isSessionsFirstFetchFinished: false,
      sessions: [],
    });
    const { result } = renderHook(() => useSwitchSession());
    const previousCancellationGeneration = getAssistantHydrationCancellationGeneration();

    act(() => {
      expect(result.current('inbox')).toBe(true);
    });

    expect(getAssistantHydrationCancellationGeneration()).toBe(previousCancellationGeneration + 1);
    expect(pushMock).toHaveBeenCalledWith('/chat', {
      query: { session: 'inbox', showMobileWorkspace: 'true' },
    });
  });

  it('blocks a session after account ownership is invalidated', () => {
    const { result } = renderHook(() => useSwitchSession());
    act(() => {
      useUserStore.setState({
        isUserStateInit: false,
        userStateScope: undefined,
      });
    });

    act(() => {
      expect(result.current('assistant-a')).toBe(false);
    });

    expect(useChatStore.getState().togglePortal).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('omits the mobile workspace flag on desktop navigation', () => {
    serverConfigState.isMobile = false;
    const { result } = renderHook(() => useSwitchSession());

    act(() => {
      expect(result.current('assistant-a')).toBe(true);
    });

    expect(pushMock).toHaveBeenCalledWith('/chat', {
      query: { session: 'assistant-a' },
    });
  });
});
