import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeBaseService } from '@/services/knowledgeBase';
import { useUserStore } from '@/store/user';
import { CreateKnowledgeBaseParams, KnowledgeBaseItem } from '@/types/knowledgeBase';

import { useKnowledgeBaseStore } from '../../store';

const mutateAccountSWR = vi.hoisted(() => vi.fn());

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/swr')>()),
  mutateAccountSWR,
}));

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  useUserStore.setState({
    ownershipInvalidationGeneration: 0,
    userStateInitializationFailure: undefined,
  });
  useKnowledgeBaseStore.setState(
    {
      activeKnowledgeBaseId: null,
      activeKnowledgeBaseItems: {},
      initKnowledgeBaseList: false,
      knowledgeBaseLoadingIds: [],
      knowledgeBaseRenamingId: null,
      scopeGeneration: 0,
    },
    false,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KnowledgeBaseCrudAction', () => {
  describe('account mutation quarantine', () => {
    it('blocks every CRUD mutation during a same-scope owner mismatch', async () => {
      const createKnowledgeBase = vi
        .spyOn(knowledgeBaseService, 'createKnowledgeBase')
        .mockResolvedValue('unexpected-id');
      const deleteKnowledgeBase = vi
        .spyOn(knowledgeBaseService, 'deleteKnowledgeBase')
        .mockResolvedValue(undefined as any);
      const updateKnowledgeBase = vi
        .spyOn(knowledgeBaseService, 'updateKnowledgeBaseList')
        .mockResolvedValue(undefined as any);
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'local',
        },
      });

      const store = useKnowledgeBaseStore.getState();
      const createdId = await store.createNewKnowledgeBase({ name: 'Blocked KB' });
      await store.removeKnowledgeBase('blocked-kb');
      await store.updateKnowledgeBase('blocked-kb', { name: 'Blocked update' });

      expect(createdId).toBe('');
      expect(createKnowledgeBase).not.toHaveBeenCalled();
      expect(deleteKnowledgeBase).not.toHaveBeenCalled();
      expect(updateKnowledgeBase).not.toHaveBeenCalled();
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).toEqual([]);
    });

    it('continues an explicit update when the active knowledge base changes', async () => {
      const updateFinished = createDeferred<void>();
      vi.spyOn(knowledgeBaseService, 'updateKnowledgeBaseList').mockReturnValue(
        updateFinished.promise,
      );
      useKnowledgeBaseStore.setState({ activeKnowledgeBaseId: 'kb-a' });

      const { result } = renderHook(() => useKnowledgeBaseStore());
      const refreshKnowledgeBaseList = vi
        .spyOn(result.current, 'refreshKnowledgeBaseList')
        .mockResolvedValue();
      let updatePromise!: ReturnType<typeof result.current.updateKnowledgeBase>;

      act(() => {
        updatePromise = result.current.updateKnowledgeBase('kb-a', { name: 'Stale update' });
      });
      await waitFor(() => {
        expect(knowledgeBaseService.updateKnowledgeBaseList).toHaveBeenCalled();
      });

      act(() => {
        useKnowledgeBaseStore.setState({ activeKnowledgeBaseId: 'kb-b' });
      });
      updateFinished.resolve();
      await act(async () => {
        await updatePromise;
      });

      expect(refreshKnowledgeBaseList).toHaveBeenCalledWith({
        accountMutationSnapshot: {
          ownershipInvalidationGeneration: 0,
          scope: 'local',
        },
        scopeGeneration: 0,
      });
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).not.toContain('kb-a');
    });

    it('stops every CRUD continuation after owner invalidation', async () => {
      const creationFinished = createDeferred<string>();
      const removalFinished = createDeferred<void>();
      const updateFinished = createDeferred<void>();
      vi.spyOn(knowledgeBaseService, 'createKnowledgeBase').mockReturnValue(
        creationFinished.promise,
      );
      vi.spyOn(knowledgeBaseService, 'deleteKnowledgeBase').mockReturnValue(
        removalFinished.promise,
      );
      vi.spyOn(knowledgeBaseService, 'updateKnowledgeBaseList').mockReturnValue(
        updateFinished.promise,
      );

      const store = useKnowledgeBaseStore.getState();
      const refreshKnowledgeBaseList = vi
        .spyOn(store, 'refreshKnowledgeBaseList')
        .mockResolvedValue();
      const creationPromise = store.createNewKnowledgeBase({ name: 'Stale creation' });
      const removalPromise = store.removeKnowledgeBase('stale-removal');
      const updatePromise = store.updateKnowledgeBase('stale-update', {
        name: 'Stale update',
      });

      await waitFor(() => {
        expect(knowledgeBaseService.createKnowledgeBase).toHaveBeenCalled();
        expect(knowledgeBaseService.deleteKnowledgeBase).toHaveBeenCalled();
        expect(knowledgeBaseService.updateKnowledgeBaseList).toHaveBeenCalled();
      });

      act(() => {
        useUserStore.setState({ ownershipInvalidationGeneration: 1 });
      });
      creationFinished.resolve('stale-created-id');
      removalFinished.resolve();
      updateFinished.resolve();

      await expect(creationPromise).resolves.toBe('');
      await removalPromise;
      await updatePromise;

      expect(refreshKnowledgeBaseList).not.toHaveBeenCalled();
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).not.toContain(
        'stale-update',
      );
    });
  });

  describe('createNewKnowledgeBase', () => {
    it('should create knowledge base and refresh list', async () => {
      const params: CreateKnowledgeBaseParams = {
        name: 'Test KB',
        description: 'Test Description',
      };

      vi.spyOn(knowledgeBaseService, 'createKnowledgeBase').mockResolvedValue('new-kb-id');

      const { result } = renderHook(() => useKnowledgeBaseStore());
      const refreshSpy = vi.spyOn(result.current, 'refreshKnowledgeBaseList').mockResolvedValue();

      const id = await act(async () => {
        return await result.current.createNewKnowledgeBase(params);
      });

      expect(knowledgeBaseService.createKnowledgeBase).toHaveBeenCalledWith(params);
      expect(refreshSpy).toHaveBeenCalledWith({
        accountMutationSnapshot: {
          ownershipInvalidationGeneration: 0,
          scope: 'local',
        },
        scopeGeneration: 0,
      });
      expect(id).toBe('new-kb-id');
    });

    it('returns the created id and refreshes when the active knowledge base changes', async () => {
      const creationFinished = createDeferred<string>();
      vi.spyOn(knowledgeBaseService, 'createKnowledgeBase').mockReturnValue(
        creationFinished.promise,
      );
      useKnowledgeBaseStore.setState({ activeKnowledgeBaseId: 'kb-a' });

      const store = useKnowledgeBaseStore.getState();
      const refreshKnowledgeBaseList = vi
        .spyOn(store, 'refreshKnowledgeBaseList')
        .mockResolvedValue();
      const creationPromise = store.createNewKnowledgeBase({ name: 'Created KB' });

      await waitFor(() => {
        expect(knowledgeBaseService.createKnowledgeBase).toHaveBeenCalled();
      });
      act(() => {
        useKnowledgeBaseStore.setState({ activeKnowledgeBaseId: 'kb-b' });
      });
      creationFinished.resolve('created-kb-id');

      await expect(creationPromise).resolves.toBe('created-kb-id');
      expect(refreshKnowledgeBaseList).toHaveBeenCalledWith({
        accountMutationSnapshot: {
          ownershipInvalidationGeneration: 0,
          scope: 'local',
        },
        scopeGeneration: 0,
      });
    });

    it('returns no navigable id when the account scope generation changes', async () => {
      const createdId = createDeferred<string>();
      vi.spyOn(knowledgeBaseService, 'createKnowledgeBase').mockReturnValue(createdId.promise);

      const { result } = renderHook(() => useKnowledgeBaseStore());
      const refreshSpy = vi.spyOn(result.current, 'refreshKnowledgeBaseList').mockResolvedValue();
      let creationPromise!: ReturnType<typeof result.current.createNewKnowledgeBase>;

      act(() => {
        creationPromise = result.current.createNewKnowledgeBase({ name: 'Account A KB' });
      });

      await waitFor(() => {
        expect(knowledgeBaseService.createKnowledgeBase).toHaveBeenCalledWith({
          name: 'Account A KB',
        });
      });

      act(() => {
        useKnowledgeBaseStore.setState((state) => ({
          scopeGeneration: state.scopeGeneration + 1,
        }));
      });
      createdId.resolve('account-a-kb-id');

      let id;
      await act(async () => {
        id = await creationPromise;
      });

      expect(id).toBe('');
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('returns no navigable id when the account changes during list refresh', async () => {
      const refreshFinished = createDeferred<void>();
      vi.spyOn(knowledgeBaseService, 'createKnowledgeBase').mockResolvedValue('account-a-kb-id');

      const { result } = renderHook(() => useKnowledgeBaseStore());
      vi.spyOn(result.current, 'refreshKnowledgeBaseList').mockReturnValue(refreshFinished.promise);
      let creationPromise!: ReturnType<typeof result.current.createNewKnowledgeBase>;

      act(() => {
        creationPromise = result.current.createNewKnowledgeBase({ name: 'Account A KB' });
      });

      await waitFor(() => {
        expect(result.current.refreshKnowledgeBaseList).toHaveBeenCalled();
      });

      act(() => {
        useKnowledgeBaseStore.setState((state) => ({
          scopeGeneration: state.scopeGeneration + 1,
        }));
      });
      refreshFinished.resolve();

      await expect(creationPromise).resolves.toBe('');
    });

    it('should handle errors during creation', async () => {
      const params: CreateKnowledgeBaseParams = {
        name: 'Test KB',
      };

      const error = new Error('Creation failed');
      vi.spyOn(knowledgeBaseService, 'createKnowledgeBase').mockRejectedValue(error);

      const { result } = renderHook(() => useKnowledgeBaseStore());

      await expect(
        act(async () => {
          await result.current.createNewKnowledgeBase(params);
        }),
      ).rejects.toThrow('Creation failed');
    });
  });

  describe('internal_toggleKnowledgeBaseLoading', () => {
    it('should add id to loading state when loading is true', () => {
      const { result } = renderHook(() => useKnowledgeBaseStore());

      act(() => {
        result.current.internal_toggleKnowledgeBaseLoading('kb-1', true);
      });

      expect(result.current.knowledgeBaseLoadingIds).toContain('kb-1');
    });

    it('should remove id from loading state when loading is false', () => {
      act(() => {
        useKnowledgeBaseStore.setState({
          knowledgeBaseLoadingIds: ['kb-1', 'kb-2'],
        });
      });

      const { result } = renderHook(() => useKnowledgeBaseStore());

      act(() => {
        result.current.internal_toggleKnowledgeBaseLoading('kb-1', false);
      });

      expect(result.current.knowledgeBaseLoadingIds).not.toContain('kb-1');
      expect(result.current.knowledgeBaseLoadingIds).toContain('kb-2');
    });

    it('should handle multiple toggle operations', () => {
      const { result } = renderHook(() => useKnowledgeBaseStore());

      act(() => {
        result.current.internal_toggleKnowledgeBaseLoading('kb-1', true);
        result.current.internal_toggleKnowledgeBaseLoading('kb-2', true);
        result.current.internal_toggleKnowledgeBaseLoading('kb-3', true);
      });

      expect(result.current.knowledgeBaseLoadingIds).toEqual(['kb-1', 'kb-2', 'kb-3']);

      act(() => {
        result.current.internal_toggleKnowledgeBaseLoading('kb-2', false);
      });

      expect(result.current.knowledgeBaseLoadingIds).toEqual(['kb-1', 'kb-3']);
    });
  });

  describe('refreshKnowledgeBaseList', () => {
    it('refreshes the supplied checkpoint scope', async () => {
      const { result } = renderHook(() => useKnowledgeBaseStore());

      await act(async () => {
        await result.current.refreshKnowledgeBaseList({
          accountMutationSnapshot: {
            ownershipInvalidationGeneration: 0,
            scope: 'local',
          },
          scopeGeneration: 0,
        });
      });

      expect(mutateAccountSWR).toHaveBeenCalledWith(['FETCH_KNOWLEDGE_BASE', 'local']);
    });

    it('rejects a stale supplied checkpoint', async () => {
      const { result } = renderHook(() => useKnowledgeBaseStore());
      useUserStore.setState({ ownershipInvalidationGeneration: 1 });

      await act(async () => {
        await result.current.refreshKnowledgeBaseList({
          accountMutationSnapshot: {
            ownershipInvalidationGeneration: 0,
            scope: 'local',
          },
          scopeGeneration: 0,
        });
      });

      expect(mutateAccountSWR).not.toHaveBeenCalled();
    });
  });

  describe('removeKnowledgeBase', () => {
    it('should delete knowledge base and refresh list', async () => {
      vi.spyOn(knowledgeBaseService, 'deleteKnowledgeBase').mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useKnowledgeBaseStore());
      const refreshSpy = vi.spyOn(result.current, 'refreshKnowledgeBaseList').mockResolvedValue();

      await act(async () => {
        await result.current.removeKnowledgeBase('kb-to-delete');
      });

      expect(knowledgeBaseService.deleteKnowledgeBase).toHaveBeenCalledWith('kb-to-delete');
      expect(refreshSpy).toHaveBeenCalledWith({
        accountMutationSnapshot: {
          ownershipInvalidationGeneration: 0,
          scope: 'local',
        },
        scopeGeneration: 0,
      });
    });

    it('refreshes after deletion when the active knowledge base changes', async () => {
      const removalFinished = createDeferred<void>();
      vi.spyOn(knowledgeBaseService, 'deleteKnowledgeBase').mockReturnValue(
        removalFinished.promise,
      );
      useKnowledgeBaseStore.setState({ activeKnowledgeBaseId: 'kb-a' });

      const store = useKnowledgeBaseStore.getState();
      const refreshKnowledgeBaseList = vi
        .spyOn(store, 'refreshKnowledgeBaseList')
        .mockResolvedValue();
      const removalPromise = store.removeKnowledgeBase('kb-to-delete');

      await waitFor(() => {
        expect(knowledgeBaseService.deleteKnowledgeBase).toHaveBeenCalledWith('kb-to-delete');
      });
      act(() => {
        useKnowledgeBaseStore.setState({ activeKnowledgeBaseId: 'kb-b' });
      });
      removalFinished.resolve();
      await removalPromise;

      expect(refreshKnowledgeBaseList).toHaveBeenCalledWith({
        accountMutationSnapshot: {
          ownershipInvalidationGeneration: 0,
          scope: 'local',
        },
        scopeGeneration: 0,
      });
    });

    it('should handle errors during deletion', async () => {
      const error = new Error('Deletion failed');
      vi.spyOn(knowledgeBaseService, 'deleteKnowledgeBase').mockRejectedValue(error);

      const { result } = renderHook(() => useKnowledgeBaseStore());

      await expect(
        act(async () => {
          await result.current.removeKnowledgeBase('kb-id');
        }),
      ).rejects.toThrow('Deletion failed');
    });
  });

  describe('updateKnowledgeBase', () => {
    it('should update knowledge base with loading states', async () => {
      const updateParams: CreateKnowledgeBaseParams = {
        name: 'Updated KB',
        description: 'Updated Description',
      };

      vi.spyOn(knowledgeBaseService, 'updateKnowledgeBaseList').mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useKnowledgeBaseStore());
      const toggleLoadingSpy = vi.spyOn(result.current, 'internal_toggleKnowledgeBaseLoading');
      const refreshSpy = vi.spyOn(result.current, 'refreshKnowledgeBaseList').mockResolvedValue();

      await act(async () => {
        await result.current.updateKnowledgeBase('kb-1', updateParams);
      });

      expect(toggleLoadingSpy).toHaveBeenCalledWith('kb-1', true);
      expect(knowledgeBaseService.updateKnowledgeBaseList).toHaveBeenCalledWith(
        'kb-1',
        updateParams,
      );
      expect(refreshSpy).toHaveBeenCalledWith({
        accountMutationSnapshot: {
          ownershipInvalidationGeneration: 0,
          scope: 'local',
        },
        scopeGeneration: 0,
      });
      expect(toggleLoadingSpy).toHaveBeenCalledWith('kb-1', false);
    });

    it('should toggle loading off even if update fails', async () => {
      const error = new Error('Update failed');
      vi.spyOn(knowledgeBaseService, 'updateKnowledgeBaseList').mockRejectedValue(error);

      const { result } = renderHook(() => useKnowledgeBaseStore());
      const toggleLoadingSpy = vi.spyOn(result.current, 'internal_toggleKnowledgeBaseLoading');

      await expect(
        act(async () => {
          await result.current.updateKnowledgeBase('kb-1', { name: 'Test' });
        }),
      ).rejects.toThrow('Update failed');

      expect(toggleLoadingSpy).toHaveBeenCalledWith('kb-1', true);
      expect(toggleLoadingSpy).toHaveBeenCalledWith('kb-1', false);
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).not.toContain('kb-1');
    });

    it('keeps loading until every overlapping update completes', async () => {
      const firstUpdate = createDeferred<void>();
      const secondUpdate = createDeferred<void>();
      vi.spyOn(knowledgeBaseService, 'updateKnowledgeBaseList')
        .mockReturnValueOnce(firstUpdate.promise)
        .mockReturnValueOnce(secondUpdate.promise);
      vi.spyOn(useKnowledgeBaseStore.getState(), 'refreshKnowledgeBaseList').mockResolvedValue();

      const firstUpdatePromise = useKnowledgeBaseStore
        .getState()
        .updateKnowledgeBase('kb-1', { name: 'First' });
      const secondUpdatePromise = useKnowledgeBaseStore
        .getState()
        .updateKnowledgeBase('kb-1', { name: 'Second' });

      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).toEqual(['kb-1']);

      firstUpdate.resolve();
      await firstUpdatePromise;
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).toEqual(['kb-1']);

      secondUpdate.resolve();
      await secondUpdatePromise;
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).toEqual([]);
    });

    it('keeps loading when a newer overlapping update rejects first', async () => {
      const firstUpdate = createDeferred<void>();
      const secondUpdate = createDeferred<void>();
      vi.spyOn(knowledgeBaseService, 'updateKnowledgeBaseList')
        .mockReturnValueOnce(firstUpdate.promise)
        .mockReturnValueOnce(secondUpdate.promise);
      vi.spyOn(useKnowledgeBaseStore.getState(), 'refreshKnowledgeBaseList').mockResolvedValue();

      const firstUpdatePromise = useKnowledgeBaseStore
        .getState()
        .updateKnowledgeBase('kb-1', { name: 'First' });
      const secondUpdatePromise = useKnowledgeBaseStore
        .getState()
        .updateKnowledgeBase('kb-1', { name: 'Second' });

      secondUpdate.reject(new Error('Second failed'));
      await expect(secondUpdatePromise).rejects.toThrow('Second failed');
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).toEqual(['kb-1']);

      firstUpdate.resolve();
      await firstUpdatePromise;
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).toEqual([]);
    });

    it('does not mutate reset loading state from a stale finalizer', async () => {
      const staleUpdate = createDeferred<void>();
      vi.spyOn(knowledgeBaseService, 'updateKnowledgeBaseList').mockReturnValue(
        staleUpdate.promise,
      );

      const staleUpdatePromise = useKnowledgeBaseStore
        .getState()
        .updateKnowledgeBase('kb-1', { name: 'Stale' });
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).toEqual(['kb-1']);

      useKnowledgeBaseStore.setState({
        knowledgeBaseLoadingIds: ['new-account-kb'],
        scopeGeneration: 1,
      });
      staleUpdate.resolve();
      await staleUpdatePromise;

      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).toEqual([
        'new-account-kb',
      ]);
    });
  });

  describe('useFetchKnowledgeBaseItem', () => {
    it('should fetch knowledge base item by id', async () => {
      const mockItem: KnowledgeBaseItem = {
        id: 'kb-1',
        name: 'Test KB',
        description: 'Test Description',
        avatar: 'avatar-url',
        type: 'file',
        enabled: true,
        isPublic: false,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseById').mockResolvedValue(mockItem);

      const { result } = renderHook(() =>
        useKnowledgeBaseStore.getState().useFetchKnowledgeBaseItem('kb-1'),
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockItem);
      });

      expect(knowledgeBaseService.getKnowledgeBaseById).toHaveBeenCalledWith('kb-1');
    });

    it('should update store state on successful fetch', async () => {
      const mockItem: KnowledgeBaseItem = {
        id: 'kb-2',
        name: 'Another KB',
        description: 'Another Description',
        avatar: 'avatar-url-2',
        type: 'file',
        enabled: true,
        isPublic: false,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseById').mockResolvedValue(mockItem);

      const { result } = renderHook(() =>
        useKnowledgeBaseStore.getState().useFetchKnowledgeBaseItem('kb-2'),
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockItem);
      });

      const state = useKnowledgeBaseStore.getState();
      expect(state.activeKnowledgeBaseId).toBe('kb-2');
      expect(state.activeKnowledgeBaseItems['kb-2']).toEqual(mockItem);
    });

    it('should not update store when item is undefined', async () => {
      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseById').mockResolvedValue(undefined);

      act(() => {
        useKnowledgeBaseStore.setState({
          activeKnowledgeBaseId: 'original-id',
          activeKnowledgeBaseItems: {},
        });
      });

      const { result } = renderHook(() =>
        useKnowledgeBaseStore.getState().useFetchKnowledgeBaseItem('kb-3'),
      );

      await waitFor(() => {
        expect(result.current.data).toBeUndefined();
      });

      const state = useKnowledgeBaseStore.getState();
      expect(state.activeKnowledgeBaseId).toBe('original-id');
      expect(state.activeKnowledgeBaseItems).toEqual({});
    });

    it('should preserve existing items when updating', async () => {
      const existingItem: KnowledgeBaseItem = {
        id: 'kb-existing',
        name: 'Existing KB',
        description: 'Existing',
        avatar: 'avatar-existing',
        type: 'file',
        enabled: true,
        isPublic: false,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const newItem: KnowledgeBaseItem = {
        id: 'kb-new',
        name: 'New KB',
        description: 'New',
        avatar: 'avatar-new',
        type: 'file',
        enabled: true,
        isPublic: false,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      act(() => {
        useKnowledgeBaseStore.setState({
          activeKnowledgeBaseItems: {
            'kb-existing': existingItem,
          },
        });
      });

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseById').mockResolvedValue(newItem);

      const { result } = renderHook(() =>
        useKnowledgeBaseStore.getState().useFetchKnowledgeBaseItem('kb-new'),
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(newItem);
      });

      const state = useKnowledgeBaseStore.getState();
      expect(state.activeKnowledgeBaseItems['kb-existing']).toEqual(existingItem);
      expect(state.activeKnowledgeBaseItems['kb-new']).toEqual(newItem);
    });
  });

  describe('useFetchKnowledgeBaseList', () => {
    it('should fetch knowledge base list with default config', async () => {
      const mockList: KnowledgeBaseItem[] = [
        {
          id: 'kb-1',
          name: 'KB 1',
          description: 'Description 1',
          avatar: 'avatar-1',
          type: 'file',
          enabled: true,
          isPublic: false,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'kb-2',
          name: 'KB 2',
          description: 'Description 2',
          avatar: 'avatar-2',
          type: 'file',
          enabled: false,
          isPublic: false,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseList').mockResolvedValue(mockList);

      const { result } = renderHook(() =>
        useKnowledgeBaseStore.getState().useFetchKnowledgeBaseList(),
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(knowledgeBaseService.getKnowledgeBaseList).toHaveBeenCalled();
    });

    it('should use fallback data when service returns empty', async () => {
      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseList').mockResolvedValue([]);

      const { result } = renderHook(() =>
        useKnowledgeBaseStore.getState().useFetchKnowledgeBaseList(),
      );

      // Wait for the SWR hook to settle
      await waitFor(() => {
        expect(result.current.data).toEqual([]);
      });
    });

    it('should initialize knowledge base list on first success', async () => {
      const mockList: KnowledgeBaseItem[] = [
        {
          id: 'kb-1',
          name: 'KB 1',
          description: 'Description 1',
          avatar: 'avatar-1',
          type: 'file',
          enabled: true,
          isPublic: false,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      act(() => {
        useKnowledgeBaseStore.setState({
          initKnowledgeBaseList: false,
        });
      });

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseList').mockResolvedValue(mockList);

      const { result } = renderHook(() =>
        useKnowledgeBaseStore.getState().useFetchKnowledgeBaseList(),
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      const state = useKnowledgeBaseStore.getState();
      expect(state.initKnowledgeBaseList).toBe(true);
    });

    it('should not re-initialize if already initialized', async () => {
      const mockList: KnowledgeBaseItem[] = [];

      act(() => {
        useKnowledgeBaseStore.setState({
          initKnowledgeBaseList: true,
        });
      });

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseList').mockResolvedValue(mockList);

      const { result } = renderHook(() =>
        useKnowledgeBaseStore.getState().useFetchKnowledgeBaseList(),
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      const state = useKnowledgeBaseStore.getState();
      expect(state.initKnowledgeBaseList).toBe(true);
    });

    it('should support suspense parameter', async () => {
      const mockList: KnowledgeBaseItem[] = [];

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseList').mockResolvedValue(mockList);

      // Don't test suspense behavior directly as it requires a full React suspense boundary
      // Just verify it accepts the parameter without error
      const { result } = renderHook(() =>
        useKnowledgeBaseStore.getState().useFetchKnowledgeBaseList({ suspense: false }),
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(knowledgeBaseService.getKnowledgeBaseList).toHaveBeenCalled();
    });
  });
});
