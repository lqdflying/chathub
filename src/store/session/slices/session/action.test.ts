import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { message } from '@/components/AntdStaticMethods';
import { SESSION_CHAT_URL } from '@/const/url';
import { chatGroupService } from '@/services/chatGroup';
import { sessionService } from '@/services/session';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';
import { LobeSessionType } from '@/types/session';

import { sessionSelectors } from './selectors';

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

// Mock sessionService 和其他依赖项
vi.mock('@/services/session', () => ({
  sessionService: {
    removeAllSessions: vi.fn(),
    createSession: vi.fn(),
    cloneSession: vi.fn(),
    updateSessionGroup: vi.fn(),
    removeSession: vi.fn(),
    getAllSessions: vi.fn(),
    updateSession: vi.fn(),
    updateSessionMeta: vi.fn(),
    updateSessionGroupId: vi.fn(),
    searchSessions: vi.fn(),
    updateSessionPinned: vi.fn(),
  },
}));

vi.mock('@/services/chatGroup', () => ({
  chatGroupService: {
    updateGroup: vi.fn(),
  },
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    destroy: vi.fn(),
  },
}));

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

const mockRefresh = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  useUserStore.setState({
    authUserId: 'account-a',
    isLoaded: true,
    isSignedIn: true,
    isUserStateInit: true,
    ownershipInvalidationGeneration: 0,
    user: { id: 'account-a' },
    userStateScope: 'user:account-a',
    userStateInitializationFailure: undefined,
  });
  useSessionStore.setState({
    activeId: 'account-a-session',
    refreshSessions: mockRefresh,
    scopeGeneration: 0,
    sessions: [],
    signalSessionMeta: undefined,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SessionAction', () => {
  describe('account mutation ownership', () => {
    it('does not persist or optimistically mutate sessions during a same-scope owner mismatch', async () => {
      const accountSession = {
        id: 'account-a-session',
        meta: { title: 'Account A Session' },
        pinned: false,
        type: LobeSessionType.Agent,
      } as any;
      const groupSession = {
        id: 'account-a-group',
        meta: { title: 'Account A Group' },
        type: LobeSessionType.Group,
      } as any;
      useSessionStore.setState({
        sessions: [accountSession, groupSession],
      });
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'user:account-a',
        },
      });
      const sessionsBeforeMutations = useSessionStore.getState().sessions;
      const signalBeforeMutations = useSessionStore.getState().signalSessionMeta;

      await act(async () => {
        const store = useSessionStore.getState();
        await store.clearSessions();
        await store.createSession();
        await store.duplicateSession(accountSession.id);
        await store.pinSession(accountSession.id, true);
        await store.internal_updateSession(accountSession.id, { group: 'new-group' });
        await store.removeSession(accountSession.id);
        await store.updateSessionGroupId(groupSession.id, 'new-group');
        await store.updateSessionMeta({ title: 'Blocked current session title' });
        await store.updateSessionMetaById(accountSession.id, { title: 'Blocked title' });
        await store.triggerSessionUpdate(accountSession.id);
      });

      expect(sessionService.removeAllSessions).not.toHaveBeenCalled();
      expect(sessionService.createSession).not.toHaveBeenCalled();
      expect(sessionService.cloneSession).not.toHaveBeenCalled();
      expect(sessionService.updateSession).not.toHaveBeenCalled();
      expect(sessionService.removeSession).not.toHaveBeenCalled();
      expect(sessionService.updateSessionMeta).not.toHaveBeenCalled();
      expect(chatGroupService.updateGroup).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
      expect(message.loading).not.toHaveBeenCalled();
      expect(useSessionStore.getState().sessions).toBe(sessionsBeforeMutations);
      expect(useSessionStore.getState().signalSessionMeta).toBe(signalBeforeMutations);
      expect(useSessionStore.getState().activeId).toBe('account-a-session');
    });

    it('does not refresh or switch after stale session removal completes', async () => {
      const removalFinished = createDeferred<void>();
      vi.mocked(sessionService.removeSession).mockReturnValue(removalFinished.promise);
      const { result } = renderHook(() => useSessionStore());
      let removalPromise!: ReturnType<typeof result.current.removeSession>;

      act(() => {
        removalPromise = result.current.removeSession('account-a-session');
      });
      await waitFor(() => {
        expect(sessionService.removeSession).toHaveBeenCalledWith('account-a-session');
      });

      act(() => {
        useSessionStore.setState({
          activeId: 'account-b-session',
          scopeGeneration: 1,
        });
      });
      removalFinished.resolve();

      await act(async () => {
        await removalPromise;
      });

      expect(mockRefresh).not.toHaveBeenCalled();
      expect(useSessionStore.getState().activeId).toBe('account-b-session');
    });

    it('does not refresh after a stale optimistic session update completes', async () => {
      const updateFinished = createDeferred<void>();
      vi.mocked(sessionService.updateSession).mockReturnValue(updateFinished.promise);
      useSessionStore.setState({
        sessions: [
          {
            id: 'account-a-session',
            meta: { title: 'Account A Session' },
            pinned: false,
            type: LobeSessionType.Agent,
          } as any,
        ],
      });
      const { result } = renderHook(() => useSessionStore());
      let updatePromise!: ReturnType<typeof result.current.pinSession>;

      act(() => {
        updatePromise = result.current.pinSession('account-a-session', true);
      });
      await waitFor(() => {
        expect(sessionService.updateSession).toHaveBeenCalledWith('account-a-session', {
          pinned: true,
        });
      });

      act(() => {
        useSessionStore.setState({
          scopeGeneration: 1,
          sessions: [
            {
              id: 'account-b-session',
              meta: { title: 'Account B Session' },
              pinned: false,
              type: LobeSessionType.Agent,
            } as any,
          ],
        });
      });
      updateFinished.resolve();

      await act(async () => {
        await updatePromise;
      });

      expect(mockRefresh).not.toHaveBeenCalled();
      expect(useSessionStore.getState().sessions).toEqual([
        expect.objectContaining({ id: 'account-b-session', pinned: false }),
      ]);
    });
  });

  describe('clearSessions', () => {
    it('should clear all sessions and refresh the list', async () => {
      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.clearSessions();
      });

      expect(sessionService.removeAllSessions).toHaveBeenCalled();
      expect(mockRefresh).toHaveBeenCalled(); // 假设 refreshSessions 调用了 getSessions
    });
  });

  describe('createSession', () => {
    it('should create a new session and switch to it', async () => {
      const { result } = renderHook(() => useSessionStore());
      const newSessionId = 'new-session-id';
      vi.mocked(sessionService.createSession).mockResolvedValue(newSessionId);

      let createdSessionId;

      await act(async () => {
        createdSessionId = await result.current.createSession({
          config: { chatConfig: { displayMode: 'docs' } },
        });
      });

      const call = vi.mocked(sessionService.createSession).mock.calls[0];
      expect(call[0]).toEqual(LobeSessionType.Agent);
      expect(call[1]).toMatchObject({ config: { chatConfig: { displayMode: 'docs' } } });

      expect(createdSessionId).toBe(newSessionId);
    });

    it('does not refresh or switch after the account changes during creation', async () => {
      const createdSession = createDeferred<string>();
      vi.mocked(sessionService.createSession).mockReturnValue(createdSession.promise);
      const { result } = renderHook(() => useSessionStore());
      let creationPromise!: ReturnType<typeof result.current.createSession>;

      act(() => {
        creationPromise = result.current.createSession({
          config: { chatConfig: { displayMode: 'docs' } },
        });
      });

      await waitFor(() => {
        expect(sessionService.createSession).toHaveBeenCalled();
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
      });
      createdSession.resolve('account-a-new-session');

      let createdSessionId!: string;
      await act(async () => {
        createdSessionId = await creationPromise;
      });

      expect(createdSessionId).toBe('');
      expect(mockRefresh).not.toHaveBeenCalled();
      expect(useSessionStore.getState().activeId).toBe('account-b-session');
    });

    it('should create a new session but not switch to it if isSwitchSession is false', async () => {
      const { result } = renderHook(() => useSessionStore());
      const newSessionId = 'new-session-id';
      vi.mocked(sessionService.createSession).mockResolvedValue(newSessionId);

      let createdSessionId;

      await act(async () => {
        createdSessionId = await result.current.createSession(
          { config: { chatConfig: { displayMode: 'docs' } } },
          false,
        );
      });

      const call = vi.mocked(sessionService.createSession).mock.calls[0];
      expect(call[0]).toEqual(LobeSessionType.Agent);
      expect(call[1]).toMatchObject({ config: { chatConfig: { displayMode: 'docs' } } });

      expect(createdSessionId).toBe(newSessionId);
    });
  });

  describe('cloneSession', () => {
    it('should duplicate a session and switch to the new one', async () => {
      const { result } = renderHook(() => useSessionStore());
      const sessionId = 'session-id';
      const duplicatedSessionId = 'duplicated-session-id';
      act(() => {
        useSessionStore.setState({
          sessions: [{ id: sessionId, meta: { title: 'Original Session' } } as any],
        });
      });
      vi.mocked(sessionService.cloneSession).mockResolvedValue(duplicatedSessionId);
      vi.mocked(message.loading).mockResolvedValue(true);

      await act(async () => {
        await result.current.duplicateSession(sessionId);
      });

      expect(message.loading).toHaveBeenCalled();
      expect(sessionService.cloneSession).toHaveBeenCalledWith(sessionId, undefined);
      expect(mockRefresh).toHaveBeenCalled();
      expect(useSessionStore.getState().activeId).toBe(duplicatedSessionId);
    });

    it('uses an operation-owned loading notice for overlapping duplications', async () => {
      const firstClone = createDeferred<string>();
      const secondClone = createDeferred<string>();
      const sessionId = 'session-id';
      useSessionStore.setState({
        sessions: [{ id: sessionId, meta: { title: 'Original Session' } } as any],
      });
      vi.mocked(sessionService.cloneSession)
        .mockReturnValueOnce(firstClone.promise)
        .mockReturnValueOnce(secondClone.promise);
      const { result } = renderHook(() => useSessionStore());
      let firstDuplicatePromise!: ReturnType<typeof result.current.duplicateSession>;
      let secondDuplicatePromise!: ReturnType<typeof result.current.duplicateSession>;

      act(() => {
        firstDuplicatePromise = result.current.duplicateSession(sessionId);
        secondDuplicatePromise = result.current.duplicateSession(sessionId);
      });
      await waitFor(() => {
        expect(message.loading).toHaveBeenCalledTimes(2);
      });

      const firstLoadingKey = vi.mocked(message.loading).mock.calls[0][0].key;
      const secondLoadingKey = vi.mocked(message.loading).mock.calls[1][0].key;
      expect(firstLoadingKey).toMatch(/^duplicateSession\.loading-/);
      expect(secondLoadingKey).toMatch(/^duplicateSession\.loading-/);
      expect(firstLoadingKey).not.toBe(secondLoadingKey);

      firstClone.resolve('first-duplicated-session');
      await act(async () => {
        await firstDuplicatePromise;
      });

      expect(message.destroy).toHaveBeenCalledWith(firstLoadingKey);
      expect(message.destroy).not.toHaveBeenCalledWith(secondLoadingKey);

      secondClone.resolve('second-duplicated-session');
      await act(async () => {
        await secondDuplicatePromise;
      });

      expect(message.destroy).toHaveBeenCalledWith(secondLoadingKey);
    });

    it('does not refresh or switch after the account changes during duplication', async () => {
      const clonedSession = createDeferred<string>();
      vi.mocked(sessionService.cloneSession).mockReturnValue(clonedSession.promise);
      const { result } = renderHook(() => useSessionStore());
      const sessionId = 'account-a-session';
      act(() => {
        useSessionStore.setState({
          activeId: sessionId,
          sessions: [{ id: sessionId, meta: { title: 'Account A Session' } } as any],
        });
      });

      let duplicatePromise!: ReturnType<typeof result.current.duplicateSession>;
      act(() => {
        duplicatePromise = result.current.duplicateSession(sessionId);
      });

      await waitFor(() => {
        expect(sessionService.cloneSession).toHaveBeenCalled();
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
      });
      clonedSession.resolve('stale-account-a-clone');

      await act(async () => {
        await duplicatePromise;
      });

      expect(mockRefresh).not.toHaveBeenCalled();
      expect(message.success).not.toHaveBeenCalled();
      expect(useSessionStore.getState().activeId).toBe('account-b-session');
    });
  });

  describe('removeSession', () => {
    it('should remove a session and refresh the list', async () => {
      const { result } = renderHook(() => useSessionStore());
      const sessionId = 'session-id';

      await act(async () => {
        await result.current.removeSession(sessionId);
      });

      expect(sessionService.removeSession).toHaveBeenCalledWith(sessionId);
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  describe('activeSession', () => {
    it('should set the provided session id as active', async () => {
      const { result } = renderHook(() => useSessionStore());
      const sessionId = 'active-session-id';

      act(() => {
        result.current.switchSession(sessionId);
      });

      expect(result.current.activeId).toBe(sessionId);
    });
  });

  describe('pinSession', () => {
    it('should pin a session when pinned is true', async () => {
      const { result } = renderHook(() => useSessionStore());
      const sessionId = 'session-id-to-pin';

      await act(async () => {
        await result.current.pinSession(sessionId, true);
      });

      expect(sessionService.updateSession).toHaveBeenCalledWith(sessionId, { pinned: true });
      expect(mockRefresh).toHaveBeenCalled();
    });

    it('should unpin a session when pinned is false', async () => {
      const { result } = renderHook(() => useSessionStore());
      const sessionId = 'session-id-to-unpin';

      await act(async () => {
        await result.current.pinSession(sessionId, false);
      });

      expect(sessionService.updateSession).toHaveBeenCalledWith(sessionId, { pinned: false });
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  describe('updateSessionGroupId', () => {
    it('should update regular session group and refresh the list', async () => {
      const { result } = renderHook(() => useSessionStore());
      const sessionId = 'session-id';
      const groupId = 'new-group-id';

      // Mock session selector to return a regular agent session
      vi.spyOn(sessionSelectors, 'getSessionById').mockReturnValue(
        () =>
          ({
            id: sessionId,
            type: 'agent',
          }) as any,
      );

      await act(async () => {
        await result.current.updateSessionGroupId(sessionId, groupId);
      });

      expect(sessionService.updateSession).toHaveBeenCalledWith(sessionId, { group: groupId });
      expect(mockRefresh).toHaveBeenCalled();
    });

    it('should update chat group session and refresh the list', async () => {
      const { result } = renderHook(() => useSessionStore());
      const sessionId = 'group-session-id';
      const groupId = 'new-group-id';

      // Mock session selector to return a group session
      vi.spyOn(sessionSelectors, 'getSessionById').mockReturnValue(
        () =>
          ({
            id: sessionId,
            type: 'group',
          }) as any,
      );

      await act(async () => {
        await result.current.updateSessionGroupId(sessionId, groupId);
      });

      expect(chatGroupService.updateGroup).toHaveBeenCalledWith(sessionId, { groupId });
      expect(mockRefresh).toHaveBeenCalled();
    });

    it('should handle default group for chat group sessions', async () => {
      const { result } = renderHook(() => useSessionStore());
      const sessionId = 'group-session-id';
      const groupId = 'default';

      // Mock session selector to return a group session
      vi.spyOn(sessionSelectors, 'getSessionById').mockReturnValue(
        () =>
          ({
            id: sessionId,
            type: 'group',
          }) as any,
      );

      await act(async () => {
        await result.current.updateSessionGroupId(sessionId, groupId);
      });

      expect(chatGroupService.updateGroup).toHaveBeenCalledWith(sessionId, { groupId: null });
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  describe('updateAgentMeta', () => {
    it('should not update meta if there is no current session', async () => {
      const { result } = renderHook(() => useSessionStore());
      const meta = { title: 'Test Agent' };

      await act(async () => {
        await result.current.updateSessionMeta(meta as any);
      });

      expect(sessionService.updateSessionMeta).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('should update session meta and refresh sessions', async () => {
      const { result } = renderHook(() => useSessionStore());
      const meta = { title: 'Test Agent' };

      act(() => {
        useSessionStore.setState({
          activeId: 'session-id',
          sessions: [{ id: 'session-id', meta, type: LobeSessionType.Agent } as any],
        });
      });

      await act(async () => {
        await result.current.updateSessionMeta(meta);
      });

      expect(sessionService.updateSessionMeta).toHaveBeenCalledWith(
        'session-id',
        meta,
        expect.any(AbortSignal),
      );
      expect(mockRefresh).toHaveBeenCalled();
    });

    it('does not refresh after a superseded metadata controller completes', async () => {
      const firstUpdateFinished = createDeferred<void>();
      const secondUpdateFinished = createDeferred<void>();
      vi.mocked(sessionService.updateSessionMeta)
        .mockReturnValueOnce(firstUpdateFinished.promise)
        .mockReturnValueOnce(secondUpdateFinished.promise);
      useSessionStore.setState({
        activeId: 'session-id',
        sessions: [
          {
            id: 'session-id',
            meta: { title: 'Original title' },
            type: LobeSessionType.Agent,
          } as any,
        ],
      });
      const { result } = renderHook(() => useSessionStore());
      let firstUpdatePromise!: ReturnType<typeof result.current.updateSessionMeta>;
      let secondUpdatePromise!: ReturnType<typeof result.current.updateSessionMeta>;

      act(() => {
        firstUpdatePromise = result.current.updateSessionMeta({ title: 'First title' });
        secondUpdatePromise = result.current.updateSessionMeta({ title: 'Second title' });
      });
      await waitFor(() => {
        expect(sessionService.updateSessionMeta).toHaveBeenCalledTimes(2);
      });

      firstUpdateFinished.resolve();
      await act(async () => {
        await firstUpdatePromise;
      });
      expect(mockRefresh).not.toHaveBeenCalled();

      secondUpdateFinished.resolve();
      await act(async () => {
        await secondUpdatePromise;
      });
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });
});
