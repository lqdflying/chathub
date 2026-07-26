import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatGroupItem } from '@/database/schemas/chatGroup';
import { chatGroupService } from '@/services/chatGroup';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';

import { useChatGroupStore } from './store';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

describe('chat group action ownership', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useUserStore.setState({
      authUserId: 'account-a',
      isLoaded: true,
      isSignedIn: true,
      user: { id: 'account-a' },
    });
    useSessionStore.setState({
      activeId: 'account-a-session',
      refreshSessions: vi.fn(),
      scopeGeneration: 0,
      switchSession: vi.fn(),
    });
    useChatGroupStore.setState({
      groupMap: {},
      groups: [],
      scopeGeneration: 0,
    });
  });

  it('does not insert or switch to a group created for an earlier account', async () => {
    const createdGroup = createDeferred<Awaited<ReturnType<typeof chatGroupService.createGroup>>>();
    vi.spyOn(chatGroupService, 'createGroup').mockReturnValue(createdGroup.promise);

    const { result } = renderHook(() => useChatGroupStore());
    const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchChatGroup');
    const loadGroupsSpy = vi.spyOn(result.current, 'loadGroups');
    let creationPromise!: ReturnType<typeof result.current.createGroup>;

    act(() => {
      creationPromise = result.current.createGroup({
        title: 'Account A Group',
      });
    });

    await waitFor(() => {
      expect(chatGroupService.createGroup).toHaveBeenCalled();
    });

    act(() => {
      useUserStore.setState({
        authUserId: 'account-b',
        user: { id: 'account-b' },
      });
      useSessionStore.setState({
        activeId: 'account-b-session',
        scopeGeneration: 1,
      });
      useChatGroupStore.setState({
        groupMap: {},
        groups: [],
        scopeGeneration: 1,
      });
    });
    createdGroup.resolve({
      id: 'account-a-group',
      title: 'Account A Group',
    } as Awaited<ReturnType<typeof chatGroupService.createGroup>>);

    let createdGroupId!: string;
    await act(async () => {
      createdGroupId = await creationPromise;
    });

    expect(createdGroupId).toBe('');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(loadGroupsSpy).not.toHaveBeenCalled();
    expect(useSessionStore.getState().refreshSessions).not.toHaveBeenCalled();
    expect(useSessionStore.getState().switchSession).not.toHaveBeenCalled();
    expect(useSessionStore.getState().activeId).toBe('account-b-session');
    expect(useChatGroupStore.getState().groups).toEqual([]);
  });

  it('ignores an earlier group refresh after an A-to-B-to-A reset', async () => {
    const staleGroups = createDeferred<ChatGroupItem[]>();
    vi.spyOn(chatGroupService, 'getGroups').mockReturnValue(staleGroups.promise);

    const { result } = renderHook(() => useChatGroupStore());
    let refreshPromise!: ReturnType<typeof result.current.internal_refreshGroups>;

    act(() => {
      refreshPromise = result.current.internal_refreshGroups();
    });

    await waitFor(() => {
      expect(chatGroupService.getGroups).toHaveBeenCalledTimes(1);
    });

    const currentAccountGroups = [
      {
        id: 'account-a-current-group',
        title: 'Current Account A Group',
      } as ChatGroupItem,
    ];
    act(() => {
      useUserStore.setState({
        authUserId: 'account-b',
        user: { id: 'account-b' },
      });
      useChatGroupStore.setState({
        groupMap: {},
        groups: [],
        scopeGeneration: 1,
      });
      useUserStore.setState({
        authUserId: 'account-a',
        user: { id: 'account-a' },
      });
      useChatGroupStore.setState({
        groupMap: { 'account-a-current-group': currentAccountGroups[0] },
        groups: currentAccountGroups,
        isGroupsLoading: false,
      });
    });

    staleGroups.resolve([
      {
        id: 'account-a-stale-group',
        title: 'Stale Account A Group',
      } as ChatGroupItem,
    ]);

    await act(async () => {
      await refreshPromise;
    });

    expect(chatGroupService.getGroups).toHaveBeenCalledTimes(1);
    expect(useChatGroupStore.getState().groups).toEqual(currentAccountGroups);
    expect(useChatGroupStore.getState().groupMap).toEqual({
      'account-a-current-group': currentAccountGroups[0],
    });
    expect(useSessionStore.getState().refreshSessions).not.toHaveBeenCalled();
  });
});
