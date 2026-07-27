import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { message } from '@/components/AntdStaticMethods';
import { sessionService } from '@/services/session';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';

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

beforeEach(() => {
  vi.clearAllMocks();
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
    sessionGroups: [],
    sessions: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    destroy: vi.fn(),
  },
}));

describe('createSessionGroupSlice', () => {
  describe('account mutation ownership', () => {
    it('blocks every group mutation during a same-scope owner mismatch', async () => {
      const createSessionGroup = vi
        .spyOn(sessionService, 'createSessionGroup')
        .mockResolvedValue('unexpected-group');
      const removeSessionGroups = vi
        .spyOn(sessionService, 'removeSessionGroups')
        .mockResolvedValue(undefined);
      const removeSessionGroup = vi
        .spyOn(sessionService, 'removeSessionGroup')
        .mockResolvedValue(undefined);
      const updateSessionGroup = vi
        .spyOn(sessionService, 'updateSessionGroup')
        .mockResolvedValue(undefined);
      const updateSessionGroupOrder = vi
        .spyOn(sessionService, 'updateSessionGroupOrder')
        .mockResolvedValue(undefined);
      const updateSession = vi.spyOn(sessionService, 'updateSession').mockResolvedValue(undefined);
      const accountSession = {
        id: 'account-a-session',
        group: 'original-group',
        meta: { title: 'Account A Session' },
        type: 'agent',
      } as any;
      const accountSessionGroups = [
        { id: 'group-a', name: 'Group A', sort: 0 },
        { id: 'group-b', name: 'Group B', sort: 1 },
      ] as any;
      useSessionStore.setState({
        sessionGroups: accountSessionGroups,
        sessions: [accountSession],
      });
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'user:account-a',
        },
      });
      const sessionsBeforeMutations = useSessionStore.getState().sessions;
      const groupsBeforeMutations = useSessionStore.getState().sessionGroups;

      let createdGroupId!: string;
      await act(async () => {
        const store = useSessionStore.getState();
        createdGroupId = await store.addSessionGroup('Blocked Group');
        await store.clearSessionGroups();
        await store.removeSessionGroup('group-a');
        await store.updateSessionGroupName('group-a', 'Blocked Name');
        await store.updateSessionGroupSort([...accountSessionGroups].reverse());
        await store.updateSessionGroupId(accountSession.id, 'group-b');
      });

      expect(createdGroupId).toBe('');
      expect(createSessionGroup).not.toHaveBeenCalled();
      expect(removeSessionGroups).not.toHaveBeenCalled();
      expect(removeSessionGroup).not.toHaveBeenCalled();
      expect(updateSessionGroup).not.toHaveBeenCalled();
      expect(updateSessionGroupOrder).not.toHaveBeenCalled();
      expect(updateSession).not.toHaveBeenCalled();
      expect(message.loading).not.toHaveBeenCalled();
      expect(message.success).not.toHaveBeenCalled();
      expect(useSessionStore.getState().sessions).toBe(sessionsBeforeMutations);
      expect(useSessionStore.getState().sessionGroups).toBe(groupsBeforeMutations);
    });

    it('suppresses every pending group mutation continuation after scope invalidation', async () => {
      const createdGroup = createDeferred<string>();
      const clearedGroups = createDeferred<void>();
      const removedGroup = createDeferred<void>();
      const renamedGroup = createDeferred<void>();
      const reorderedGroups = createDeferred<void>();
      const associatedSession = createDeferred<void>();
      vi.spyOn(sessionService, 'createSessionGroup').mockReturnValue(createdGroup.promise);
      vi.spyOn(sessionService, 'removeSessionGroups').mockReturnValue(clearedGroups.promise);
      vi.spyOn(sessionService, 'removeSessionGroup').mockReturnValue(removedGroup.promise);
      vi.spyOn(sessionService, 'updateSessionGroup').mockReturnValue(renamedGroup.promise);
      vi.spyOn(sessionService, 'updateSessionGroupOrder').mockReturnValue(
        reorderedGroups.promise,
      );
      vi.spyOn(sessionService, 'updateSession').mockReturnValue(associatedSession.promise);
      const refreshSessions = vi.fn();
      const accountSession = {
        id: 'account-a-session',
        group: 'group-a',
        meta: { title: 'Account A Session' },
        type: 'agent',
      } as any;
      const accountSessionGroups = [
        { id: 'group-a', name: 'Group A', sort: 0 },
        { id: 'group-b', name: 'Group B', sort: 1 },
      ] as any;
      useSessionStore.setState({
        refreshSessions,
        sessionGroups: accountSessionGroups,
        sessions: [accountSession],
      });
      const { result } = renderHook(() => useSessionStore());
      let addPromise!: ReturnType<typeof result.current.addSessionGroup>;
      let clearPromise!: ReturnType<typeof result.current.clearSessionGroups>;
      let removePromise!: ReturnType<typeof result.current.removeSessionGroup>;
      let renamePromise!: ReturnType<typeof result.current.updateSessionGroupName>;
      let sortPromise!: ReturnType<typeof result.current.updateSessionGroupSort>;
      let associationPromise!: ReturnType<typeof result.current.updateSessionGroupId>;

      act(() => {
        addPromise = result.current.addSessionGroup('New Group');
        clearPromise = result.current.clearSessionGroups();
        removePromise = result.current.removeSessionGroup('group-a');
        renamePromise = result.current.updateSessionGroupName('group-a', 'Renamed Group');
        sortPromise = result.current.updateSessionGroupSort([...accountSessionGroups].reverse());
        associationPromise = result.current.updateSessionGroupId(accountSession.id, 'group-b');
      });
      await waitFor(() => {
        expect(sessionService.createSessionGroup).toHaveBeenCalled();
        expect(sessionService.removeSessionGroups).toHaveBeenCalled();
        expect(sessionService.removeSessionGroup).toHaveBeenCalled();
        expect(sessionService.updateSessionGroup).toHaveBeenCalled();
        expect(sessionService.updateSessionGroupOrder).toHaveBeenCalled();
        expect(sessionService.updateSession).toHaveBeenCalled();
        expect(message.loading).toHaveBeenCalled();
      });

      const currentAccountGroups = [
        { id: 'account-b-group', name: 'Account B Group', sort: 0 },
      ] as any;
      const currentAccountSessions = [
        {
          id: 'account-b-session',
          group: 'account-b-group',
          meta: { title: 'Account B Session' },
          type: 'agent',
        },
      ] as any;
      act(() => {
        useSessionStore.setState((state) => ({
          activeId: 'account-b-session',
          scopeGeneration: state.scopeGeneration + 1,
          sessionGroups: currentAccountGroups,
          sessions: currentAccountSessions,
        }));
      });
      createdGroup.resolve('stale-account-a-group');
      clearedGroups.resolve();
      removedGroup.resolve();
      renamedGroup.resolve();
      reorderedGroups.resolve();
      associatedSession.resolve();

      let createdGroupId!: string;
      await act(async () => {
        createdGroupId = await addPromise;
        await Promise.all([
          clearPromise,
          removePromise,
          renamePromise,
          sortPromise,
          associationPromise,
        ]);
      });

      expect(createdGroupId).toBe('');
      expect(refreshSessions).not.toHaveBeenCalled();
      expect(message.destroy).not.toHaveBeenCalled();
      expect(message.success).not.toHaveBeenCalled();
      expect(useSessionStore.getState().sessionGroups).toBe(currentAccountGroups);
      expect(useSessionStore.getState().sessions).toBe(currentAccountSessions);
    });
  });

  describe('addSessionGroup', () => {
    it('should add a session group and refresh sessions', async () => {
      const mockId = 'mock-id';
      const mockName = 'Test Group';
      vi.spyOn(sessionService, 'createSessionGroup').mockResolvedValue(mockId);
      const spyOnRefreshSessions = vi.spyOn(useSessionStore.getState(), 'refreshSessions');

      const { result } = renderHook(() => useSessionStore());

      let returnedId;
      await act(async () => {
        returnedId = await result.current.addSessionGroup(mockName);
      });

      expect(sessionService.createSessionGroup).toHaveBeenCalledWith(mockName);
      expect(spyOnRefreshSessions).toHaveBeenCalled();
      expect(returnedId).toBe(mockId);
    });

    it('returns no group id when scope invalidates during refresh', async () => {
      const refreshFinished = createDeferred<void>();
      vi.spyOn(sessionService, 'createSessionGroup').mockResolvedValue('account-a-group');
      const refreshSessions = vi.fn().mockReturnValue(refreshFinished.promise);
      useSessionStore.setState({ refreshSessions });
      const { result } = renderHook(() => useSessionStore());
      let creationPromise!: ReturnType<typeof result.current.addSessionGroup>;

      act(() => {
        creationPromise = result.current.addSessionGroup('Account A Group');
      });
      await waitFor(() => {
        expect(refreshSessions).toHaveBeenCalled();
      });

      act(() => {
        useSessionStore.setState((state) => ({
          scopeGeneration: state.scopeGeneration + 1,
        }));
      });
      refreshFinished.resolve();

      await expect(creationPromise).resolves.toBe('');
    });
  });

  describe('clearSessionGroups', () => {
    it('should clear session groups and refresh sessions', async () => {
      const spyOn = vi
        .spyOn(sessionService, 'removeSessionGroups')
        .mockResolvedValueOnce(undefined);
      const spyOnRefreshSessions = vi.spyOn(useSessionStore.getState(), 'refreshSessions');

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.clearSessionGroups();
      });

      expect(spyOn).toHaveBeenCalled();
      expect(spyOnRefreshSessions).toHaveBeenCalled();
    });
  });

  describe('removeSessionGroup', () => {
    it('should remove a session group and refresh sessions', async () => {
      const mockId = 'mock-id';
      vi.spyOn(sessionService, 'removeSessionGroup').mockResolvedValueOnce(undefined);
      const spyOnRefreshSessions = vi.spyOn(useSessionStore.getState(), 'refreshSessions');

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.removeSessionGroup(mockId);
      });

      expect(sessionService.removeSessionGroup).toHaveBeenCalledWith(mockId);
      expect(spyOnRefreshSessions).toHaveBeenCalled();
    });
  });

  describe('updateSessionGroupId', () => {
    it('should update a session group id and refresh sessions', async () => {
      const mockSessionId = 'session-id';
      const mockGroupId = 'group-id';
      vi.spyOn(sessionService, 'updateSession').mockResolvedValueOnce(undefined);
      const spyOnRefreshSessions = vi.spyOn(useSessionStore.getState(), 'refreshSessions');

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.updateSessionGroupId(mockSessionId, mockGroupId);
      });

      expect(sessionService.updateSession).toHaveBeenCalledWith(mockSessionId, {
        group: mockGroupId,
      });
      expect(spyOnRefreshSessions).toHaveBeenCalled();
    });
  });

  describe('updateSessionGroupName', () => {
    it('should update a session group name and refresh sessions', async () => {
      const mockId = 'mock-id';
      const mockName = 'New Name';
      const spyOnRefreshSessions = vi.spyOn(useSessionStore.getState(), 'refreshSessions');
      vi.spyOn(sessionService, 'updateSessionGroup').mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.updateSessionGroupName(mockId, mockName);
      });

      expect(sessionService.updateSessionGroup).toHaveBeenCalledWith(mockId, { name: mockName });
      expect(spyOnRefreshSessions).toHaveBeenCalled();
    });
  });

  describe('updateSessionGroupSort', () => {
    it('should update session group sort order and refresh sessions', async () => {
      const mockItems: any[] = [
        { id: 'id1', sort: 0 },
        { id: 'id2', sort: 1 },
      ];
      vi.spyOn(sessionService, 'updateSessionGroupOrder').mockResolvedValueOnce(undefined);
      const spyOnRefreshSessions = vi.spyOn(useSessionStore.getState(), 'refreshSessions');

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.updateSessionGroupSort(mockItems);
      });

      expect(sessionService.updateSessionGroupOrder).toHaveBeenCalledWith(
        mockItems.map((item) => ({ id: item.id, sort: item.sort })),
      );
      expect(spyOnRefreshSessions).toHaveBeenCalled();
    });
  });
});
