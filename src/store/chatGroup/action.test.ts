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
      ownershipInvalidationGeneration: 0,
      user: { id: 'account-a' },
      userStateInitializationFailure: undefined,
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
      group: {
        id: 'account-a-group',
        title: 'Account A Group',
      },
      virtualMembers: [],
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

  it('creates members in one request and refreshes groups and sessions once after commit', async () => {
    vi.spyOn(chatGroupService, 'createGroup').mockResolvedValue({
      group: {
        id: 'atomic-group',
        title: 'Atomic Group',
      },
      virtualMembers: [
        {
          agentId: 'virtual-agent',
          sessionId: 'virtual-session',
        },
      ],
    } as Awaited<ReturnType<typeof chatGroupService.createGroup>>);
    const addAgentsSpy = vi.spyOn(chatGroupService, 'addAgentsToGroup');

    const { result } = renderHook(() => useChatGroupStore());
    const loadGroupsSpy = vi.spyOn(result.current, 'loadGroups').mockResolvedValue();
    const refreshSessionsSpy = vi
      .spyOn(useSessionStore.getState(), 'refreshSessions')
      .mockResolvedValue();

    let createdGroupId!: string;
    await act(async () => {
      createdGroupId = await result.current.createGroup(
        { title: 'Atomic Group' },
        ['existing-agent'],
        false,
        [
          {
            config: { title: 'Virtual Agent', virtual: true },
            session: { title: 'Virtual Session' },
          },
        ],
      );
    });

    expect(createdGroupId).toBe('atomic-group');
    expect(chatGroupService.createGroup).toHaveBeenCalledTimes(1);
    expect(chatGroupService.createGroup).toHaveBeenCalledWith({
      agentIds: ['existing-agent'],
      group: { title: 'Atomic Group' },
      virtualSessions: [
        {
          config: { title: 'Virtual Agent', virtual: true },
          session: { title: 'Virtual Session' },
        },
      ],
    });
    expect(addAgentsSpy).not.toHaveBeenCalled();
    expect(loadGroupsSpy).toHaveBeenCalledTimes(1);
    expect(refreshSessionsSpy).toHaveBeenCalledTimes(1);
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

  it('does not load groups or set loading while a same-scope owner mismatch is active', async () => {
    const getGroups = vi.spyOn(chatGroupService, 'getGroups');
    useChatGroupStore.setState({ isGroupsLoading: false });
    useUserStore.setState({
      ownershipInvalidationGeneration: 1,
      userStateInitializationFailure: {
        reason: 'owner-mismatch',
        scope: 'user:account-a',
      },
    });

    await act(async () => {
      await useChatGroupStore.getState().loadGroups();
    });

    expect(getGroups).not.toHaveBeenCalled();
    expect(useChatGroupStore.getState().isGroupsLoading).toBe(false);
  });

  it('does not refresh or overwrite local groups after pending update ownership invalidation', async () => {
    const persistedUpdate = createDeferred<void>();
    const updateGroup = vi
      .spyOn(chatGroupService, 'updateGroup')
      .mockReturnValue(persistedUpdate.promise);
    const currentGroup = {
      id: 'account-a-group',
      title: 'Current title',
    } as ChatGroupItem;
    useChatGroupStore.setState({
      groupMap: { [currentGroup.id]: currentGroup },
      groups: [currentGroup],
    });
    const { result } = renderHook(() => useChatGroupStore());
    const refreshGroups = vi
      .spyOn(result.current, 'internal_refreshGroups')
      .mockResolvedValue(undefined);

    let updatePromise!: Promise<void>;
    act(() => {
      updatePromise = result.current.updateGroup(currentGroup.id, { title: 'Stale title' });
    });
    expect(updateGroup).toHaveBeenCalledWith(currentGroup.id, { title: 'Stale title' });

    act(() => {
      useUserStore.setState({
        ownershipInvalidationGeneration: 1,
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'user:account-a',
        },
      });
    });
    persistedUpdate.resolve();
    await act(async () => {
      await updatePromise;
    });

    expect(refreshGroups).not.toHaveBeenCalled();
    expect(useChatGroupStore.getState().groupMap[currentGroup.id]).toEqual(currentGroup);
    expect(useChatGroupStore.getState().groups).toEqual([currentGroup]);
  });
});
