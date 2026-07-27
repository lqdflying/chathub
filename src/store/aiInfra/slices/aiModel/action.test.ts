import { act, renderHook, waitFor } from '@testing-library/react';
import { AiProviderModelListItem } from 'model-bank';
import { mutate } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiModelService } from '@/services/aiModel';
import { modelsService } from '@/services/models';
import { useUserStore } from '@/store/user';

import { useAiInfraStore as useStore } from '../../store';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

// Mock SWR
vi.mock('swr', async () => {
  const actual = await vi.importActual('swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();

  // Reset store to initial state
  act(() => {
    useUserStore.setState({
      authUserId: 'test-user',
      isLoaded: true,
      isSignedIn: true,
      ownershipInvalidationGeneration: 0,
      user: { id: 'test-user' },
      userStateInitializationFailure: undefined,
    });
    useStore.setState({
      activeAiProvider: 'test-provider',
      aiModelLoadingIds: [],
      aiProviderModelList: [],
      isAiModelListInit: false,
      refreshAiProviderRuntimeState: vi.fn(),
      scopeGeneration: 0,
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AiModelAction', () => {
  describe('account mutation ownership', () => {
    it('blocks every model persistence action during an active owner mismatch', async () => {
      const batchToggleModels = vi.spyOn(aiModelService, 'batchToggleAiModels');
      const batchUpdateModels = vi.spyOn(aiModelService, 'batchUpdateAiModels');
      const clearModels = vi.spyOn(aiModelService, 'clearModelsByProvider');
      const clearRemoteModels = vi.spyOn(aiModelService, 'clearRemoteModels');
      const createModel = vi.spyOn(aiModelService, 'createAiModel');
      const deleteModel = vi.spyOn(aiModelService, 'deleteAiModel');
      const fetchRemoteModels = vi.spyOn(modelsService, 'getModels');
      const toggleModel = vi.spyOn(aiModelService, 'toggleModelEnabled');
      const updateModel = vi.spyOn(aiModelService, 'updateAiModel');
      const updateModelOrder = vi.spyOn(aiModelService, 'updateAiModelOrder');
      useUserStore.setState({
        ownershipInvalidationGeneration: 1,
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'user:test-user',
        },
      });
      const model = {
        abilities: {},
        displayName: 'Model',
        enabled: true,
        id: 'model-1',
        source: 'remote',
        type: 'chat',
      } as AiProviderModelListItem;

      const store = useStore.getState();
      await store.batchToggleAiModels(['model-1'], true);
      await store.batchUpdateAiModels([model]);
      await store.clearModelsByProvider('provider-explicit');
      await store.clearRemoteModels('provider-explicit');
      await store.createNewAiModel({
        displayName: 'Model',
        enabled: true,
        id: 'model-1',
        providerId: 'provider-explicit',
      });
      await store.fetchRemoteModelList('provider-explicit');
      await store.removeAiModel('model-1', 'provider-explicit');
      await store.toggleModelEnabled({ enabled: true, id: 'model-1' });
      await store.updateAiModelsConfig('model-1', 'provider-explicit', { enabled: false });
      await store.updateAiModelsSort('provider-explicit', [{ id: 'model-1', sort: 1 }]);

      expect(batchToggleModels).not.toHaveBeenCalled();
      expect(batchUpdateModels).not.toHaveBeenCalled();
      expect(clearModels).not.toHaveBeenCalled();
      expect(clearRemoteModels).not.toHaveBeenCalled();
      expect(createModel).not.toHaveBeenCalled();
      expect(deleteModel).not.toHaveBeenCalled();
      expect(fetchRemoteModels).not.toHaveBeenCalled();
      expect(toggleModel).not.toHaveBeenCalled();
      expect(updateModel).not.toHaveBeenCalled();
      expect(updateModelOrder).not.toHaveBeenCalled();
      expect(useStore.getState().aiModelLoadingIds).toEqual([]);
    });

    it('keeps an explicit model provider valid when the active provider changes', async () => {
      const updateFinished = createDeferred<void>();
      const model = {
        abilities: {},
        displayName: 'Explicit Model',
        enabled: true,
        id: 'model-explicit',
        source: 'remote',
        type: 'chat',
      } as AiProviderModelListItem;
      vi.spyOn(aiModelService, 'batchUpdateAiModels').mockReturnValue(updateFinished.promise);
      const refreshModels = vi.spyOn(useStore.getState(), 'refreshAiModelList').mockResolvedValue();

      const updatePromise = useStore
        .getState()
        .batchUpdateAiModels([model], 'provider-explicit');
      useStore.setState({ activeAiProvider: 'provider-unrelated' });
      updateFinished.resolve();
      await updatePromise;

      expect(refreshModels).toHaveBeenCalledWith('provider-explicit');
    });

    it('binds an active-derived provider before awaiting the model service', async () => {
      const toggleFinished = createDeferred<void>();
      vi.spyOn(aiModelService, 'batchToggleAiModels').mockReturnValue(toggleFinished.promise);
      const refreshModels = vi.spyOn(useStore.getState(), 'refreshAiModelList').mockResolvedValue();

      const togglePromise = useStore.getState().batchToggleAiModels(['model-1'], true);
      useStore.setState({ activeAiProvider: 'provider-later' });
      toggleFinished.resolve();
      await togglePromise;

      expect(aiModelService.batchToggleAiModels).toHaveBeenCalledWith(
        'test-provider',
        ['model-1'],
        true,
      );
      expect(refreshModels).toHaveBeenCalledWith('test-provider');
    });
  });

  describe('batchToggleAiModels', () => {
    it('should toggle multiple models and refresh list', async () => {
      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'batchToggleAiModels')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.batchToggleAiModels(['model-1', 'model-2'], true);
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider', ['model-1', 'model-2'], true);
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should not toggle when no active provider', async () => {
      act(() => {
        useStore.setState({ activeAiProvider: undefined });
      });

      const { result } = renderHook(() => useStore());
      const serviceSpy = vi
        .spyOn(aiModelService, 'batchToggleAiModels')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.batchToggleAiModels(['model-1'], true);
      });

      expect(serviceSpy).not.toHaveBeenCalled();
    });

    it('does not refresh another account after a pending update completes', async () => {
      const updateFinished = createDeferred<void>();
      const models = [
        {
          abilities: {},
          displayName: 'Account A Model',
          enabled: true,
          id: 'account-a-model',
          source: 'remote',
          type: 'chat',
        } as AiProviderModelListItem,
      ];
      vi.spyOn(aiModelService, 'batchUpdateAiModels').mockReturnValue(updateFinished.promise);

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi.spyOn(result.current, 'refreshAiModelList').mockResolvedValue();
      const updatePromise = result.current.batchUpdateAiModels(models, 'provider-x');

      await waitFor(() => {
        expect(aiModelService.batchUpdateAiModels).toHaveBeenCalledWith('provider-x', models);
      });

      act(() => {
        useUserStore.setState({
          authUserId: 'account-b',
          user: { id: 'account-b' },
        });
        useStore.setState({
          activeAiProvider: 'provider-y',
          scopeGeneration: 1,
        });
      });
      updateFinished.resolve();
      await updatePromise;

      expect(refreshSpy).not.toHaveBeenCalled();
    });
  });

  describe('batchUpdateAiModels', () => {
    it('should batch update models and refresh list', async () => {
      const models: AiProviderModelListItem[] = [
        {
          abilities: {},
          displayName: 'Model 1',
          enabled: true,
          id: 'model-1',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
        {
          abilities: {},
          displayName: 'Model 2',
          enabled: false,
          id: 'model-2',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
      ];

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'batchUpdateAiModels')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.batchUpdateAiModels(models);
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider', models);
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should not update when no active provider', async () => {
      act(() => {
        useStore.setState({ activeAiProvider: undefined });
      });

      const { result } = renderHook(() => useStore());
      const serviceSpy = vi
        .spyOn(aiModelService, 'batchUpdateAiModels')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.batchUpdateAiModels([]);
      });

      expect(serviceSpy).not.toHaveBeenCalled();
    });
  });

  describe('clearModelsByProvider', () => {
    it('should clear all models for provider and refresh list', async () => {
      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'clearModelsByProvider')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.clearModelsByProvider('test-provider');
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider');
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('clearRemoteModels', () => {
    it('should clear remote models for provider and refresh list', async () => {
      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi.spyOn(aiModelService, 'clearRemoteModels').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.clearRemoteModels('test-provider');
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider');
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('createNewAiModel', () => {
    it('should create new model and refresh list', async () => {
      const params = {
        displayName: 'New Model',
        enabled: true,
        id: 'new-model',
        providerId: 'test-provider',
      };

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi.spyOn(aiModelService, 'createAiModel').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.createNewAiModel(params);
      });

      expect(serviceSpy).toHaveBeenCalledWith(params);
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('fetchRemoteModelList', () => {
    it('should fetch remote models and batch update', async () => {
      const mockRemoteModels = [
        {
          displayName: 'Remote Model 1',
          enabled: true,
          files: true,
          functionCall: true,
          id: 'remote-1',
          type: 'chat',
          vision: false,
        },
        {
          displayName: 'Remote Model 2',
          enabled: false,
          id: 'remote-2',
          imageOutput: true,
          type: 'image',
        },
      ];

      const { result } = renderHook(() => useStore());
      const batchUpdateSpy = vi
        .spyOn(aiModelService, 'batchUpdateAiModels')
        .mockResolvedValue(undefined);
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      vi.spyOn(modelsService, 'getModels').mockResolvedValue(mockRemoteModels);

      await act(async () => {
        await result.current.fetchRemoteModelList('test-provider');
      });

      expect(batchUpdateSpy).toHaveBeenCalledWith('test-provider', expect.any(Array));
      const batchUpdateArg = batchUpdateSpy.mock.calls[0][1];
      expect(batchUpdateArg).toHaveLength(2);
      expect(batchUpdateArg[0]).toMatchObject({
        abilities: {
          files: true,
          functionCall: true,
          vision: false,
        },
        displayName: 'Remote Model 1',
        enabled: true,
        id: 'remote-1',
        source: 'remote',
        type: 'chat',
      });
      expect(batchUpdateArg[1]).toMatchObject({
        abilities: {
          imageOutput: true,
        },
        displayName: 'Remote Model 2',
        enabled: false,
        id: 'remote-2',
        source: 'remote',
        type: 'image',
      });

      expect(refreshSpy).toHaveBeenCalledWith('test-provider');
    });

    it('should not update if remote service returns no data', async () => {
      const { result } = renderHook(() => useStore());
      const batchUpdateSpy = vi
        .spyOn(aiModelService, 'batchUpdateAiModels')
        .mockResolvedValue(undefined);
      vi.spyOn(modelsService, 'getModels').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.fetchRemoteModelList('test-provider');
      });

      expect(batchUpdateSpy).not.toHaveBeenCalled();
    });

    it('does not persist remote models after the account changes', async () => {
      const remoteModels = createDeferred<
        Awaited<ReturnType<typeof modelsService.getModels>>
      >();
      vi.spyOn(modelsService, 'getModels').mockReturnValue(remoteModels.promise);
      const batchUpdateSpy = vi
        .spyOn(aiModelService, 'batchUpdateAiModels')
        .mockResolvedValue(undefined);

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi.spyOn(result.current, 'refreshAiModelList').mockResolvedValue();
      const fetchPromise = result.current.fetchRemoteModelList('provider-x');

      await waitFor(() => {
        expect(modelsService.getModels).toHaveBeenCalledWith('provider-x');
      });

      act(() => {
        useUserStore.setState({
          authUserId: 'account-b',
          user: { id: 'account-b' },
        });
        useStore.setState({
          activeAiProvider: 'provider-y',
          scopeGeneration: 1,
        });
      });
      remoteModels.resolve([
        {
          displayName: 'Account A Model',
          enabled: true,
          id: 'account-a-model',
        },
      ]);
      await fetchPromise;

      expect(batchUpdateSpy).not.toHaveBeenCalled();
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('suppresses persistence after same-scope ownership invalidation', async () => {
      const remoteModels = createDeferred<
        Awaited<ReturnType<typeof modelsService.getModels>>
      >();
      vi.spyOn(modelsService, 'getModels').mockReturnValue(remoteModels.promise);
      const batchUpdateSpy = vi
        .spyOn(aiModelService, 'batchUpdateAiModels')
        .mockResolvedValue(undefined);
      const refreshSpy = vi.spyOn(useStore.getState(), 'refreshAiModelList').mockResolvedValue();

      const fetchPromise = useStore.getState().fetchRemoteModelList('provider-x');
      await waitFor(() => {
        expect(modelsService.getModels).toHaveBeenCalledWith('provider-x');
      });

      useUserStore.setState({
        ownershipInvalidationGeneration: 1,
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'user:test-user',
        },
      });
      remoteModels.resolve([
        {
          displayName: 'Stale Remote Model',
          enabled: true,
          id: 'stale-model',
        },
      ]);
      await fetchPromise;

      expect(batchUpdateSpy).not.toHaveBeenCalled();
      expect(refreshSpy).not.toHaveBeenCalled();
    });
  });

  describe('internal_toggleAiModelLoading', () => {
    it('should add model id to loading list when loading is true', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.internal_toggleAiModelLoading('model-1', true);
      });

      expect(result.current.aiModelLoadingIds).toContain('model-1');
    });

    it('should remove model id from loading list when loading is false', () => {
      act(() => {
        useStore.setState({ aiModelLoadingIds: ['model-1', 'model-2'] });
      });

      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.internal_toggleAiModelLoading('model-1', false);
      });

      expect(result.current.aiModelLoadingIds).not.toContain('model-1');
      expect(result.current.aiModelLoadingIds).toContain('model-2');
    });

    it('should handle multiple loading states', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.internal_toggleAiModelLoading('model-1', true);
        result.current.internal_toggleAiModelLoading('model-2', true);
      });

      expect(result.current.aiModelLoadingIds).toEqual(['model-1', 'model-2']);

      act(() => {
        result.current.internal_toggleAiModelLoading('model-1', false);
      });

      expect(result.current.aiModelLoadingIds).toEqual(['model-2']);
    });
  });

  describe('refreshAiModelList', () => {
    it('should call mutate with correct key and trigger runtime state refresh', async () => {
      const { result } = renderHook(() => useStore());
      const refreshRuntimeSpy = vi
        .spyOn(result.current, 'refreshAiProviderRuntimeState')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.refreshAiModelList();
      });

      expect(mutate).toHaveBeenCalledWith([
        'FETCH_AI_PROVIDER_MODELS',
        'user:test-user',
        'test-provider',
        ['account-cache-epoch', 0],
      ]);
      expect(refreshRuntimeSpy).toHaveBeenCalled();
    });

    it('does not refresh runtime state after the account epoch changes', async () => {
      const refreshFinished = createDeferred<unknown>();
      vi.mocked(mutate).mockReturnValue(refreshFinished.promise);
      const { result } = renderHook(() => useStore());
      const refreshRuntimeSpy = vi
        .spyOn(result.current, 'refreshAiProviderRuntimeState')
        .mockResolvedValue(undefined);
      const refreshPromise = result.current.refreshAiModelList('provider-x');

      await waitFor(() => {
        expect(mutate).toHaveBeenCalledWith([
          'FETCH_AI_PROVIDER_MODELS',
          'user:test-user',
          'provider-x',
          ['account-cache-epoch', 0],
        ]);
      });

      act(() => {
        useUserStore.setState({
          authUserId: 'account-b',
          user: { id: 'account-b' },
        });
        useStore.setState({ scopeGeneration: 1 });
      });
      refreshFinished.resolve(undefined);
      await refreshPromise;

      expect(refreshRuntimeSpy).not.toHaveBeenCalled();
    });
  });

  describe('removeAiModel', () => {
    it('should delete model and refresh list', async () => {
      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi.spyOn(aiModelService, 'deleteAiModel').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeAiModel('model-1', 'test-provider');
      });

      expect(serviceSpy).toHaveBeenCalledWith({ id: 'model-1', providerId: 'test-provider' });
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('toggleModelEnabled', () => {
    it('should toggle model enabled state with loading indicators', async () => {
      const { result } = renderHook(() => useStore());
      const toggleLoadingSpy = vi
        .spyOn(result.current, 'internal_toggleAiModelLoading')
        .mockImplementation(() => {});
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'toggleModelEnabled')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.toggleModelEnabled({ enabled: true, id: 'model-1' });
      });

      expect(toggleLoadingSpy).toHaveBeenCalledWith('model-1', true);
      expect(serviceSpy).toHaveBeenCalledWith({
        enabled: true,
        id: 'model-1',
        providerId: 'test-provider',
      });
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleLoadingSpy).toHaveBeenCalledWith('model-1', false);
    });

    it('should not toggle when no active provider', async () => {
      act(() => {
        useStore.setState({ activeAiProvider: undefined });
      });

      const { result } = renderHook(() => useStore());
      const serviceSpy = vi
        .spyOn(aiModelService, 'toggleModelEnabled')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.toggleModelEnabled({ enabled: true, id: 'model-1' });
      });

      expect(serviceSpy).not.toHaveBeenCalled();
    });

    it('should handle service errors and clear loading owned by the failed operation', async () => {
      const { result } = renderHook(() => useStore());
      const toggleLoadingSpy = vi
        .spyOn(result.current, 'internal_toggleAiModelLoading')
        .mockImplementation(() => {});
      vi.spyOn(result.current, 'refreshAiModelList').mockResolvedValue(undefined);
      vi.spyOn(aiModelService, 'toggleModelEnabled').mockRejectedValue(new Error('Service error'));

      await expect(async () => {
        await act(async () => {
          await result.current.toggleModelEnabled({ enabled: true, id: 'model-1' });
        });
      }).rejects.toThrow('Service error');

      expect(toggleLoadingSpy).toHaveBeenCalledWith('model-1', true);
      expect(toggleLoadingSpy).toHaveBeenCalledWith('model-1', false);
    });

    it('keeps model loading until every overlapping owned operation completes', async () => {
      const firstToggleFinished = createDeferred<void>();
      const secondToggleFinished = createDeferred<void>();
      vi.spyOn(aiModelService, 'toggleModelEnabled')
        .mockReturnValueOnce(firstToggleFinished.promise)
        .mockReturnValueOnce(secondToggleFinished.promise);
      vi.spyOn(useStore.getState(), 'refreshAiModelList').mockResolvedValue();

      const firstToggle = useStore
        .getState()
        .toggleModelEnabled({ enabled: true, id: 'model-overlap' });
      const secondToggle = useStore
        .getState()
        .toggleModelEnabled({ enabled: false, id: 'model-overlap' });
      expect(useStore.getState().aiModelLoadingIds).toEqual(['model-overlap']);

      firstToggleFinished.resolve();
      await firstToggle;
      expect(useStore.getState().aiModelLoadingIds).toEqual(['model-overlap']);

      secondToggleFinished.resolve();
      await secondToggle;
      expect(useStore.getState().aiModelLoadingIds).toEqual([]);
    });

    it('shares one visible marker across providers with the same model id', async () => {
      const providerAToggleFinished = createDeferred<void>();
      const providerBToggleFinished = createDeferred<void>();
      vi.spyOn(aiModelService, 'toggleModelEnabled')
        .mockReturnValueOnce(providerAToggleFinished.promise)
        .mockReturnValueOnce(providerBToggleFinished.promise);
      vi.spyOn(useStore.getState(), 'refreshAiModelList').mockResolvedValue();

      useStore.setState({ activeAiProvider: 'provider-a' });
      const providerAToggle = useStore
        .getState()
        .toggleModelEnabled({ enabled: true, id: 'shared-model' });
      useStore.setState({ activeAiProvider: 'provider-b' });
      const providerBToggle = useStore
        .getState()
        .toggleModelEnabled({ enabled: false, id: 'shared-model' });
      expect(useStore.getState().aiModelLoadingIds).toEqual(['shared-model']);

      providerBToggleFinished.resolve();
      await providerBToggle;
      expect(useStore.getState().aiModelLoadingIds).toEqual(['shared-model']);

      providerAToggleFinished.resolve();
      await providerAToggle;
      expect(useStore.getState().aiModelLoadingIds).toEqual([]);
    });

    it('does not let stale provider buckets mutate same-id loading after account reset', async () => {
      const staleProviderAToggleFinished = createDeferred<void>();
      const staleProviderBToggleFinished = createDeferred<void>();
      const currentAccountToggleFinished = createDeferred<void>();
      vi.spyOn(aiModelService, 'toggleModelEnabled')
        .mockReturnValueOnce(staleProviderAToggleFinished.promise)
        .mockReturnValueOnce(staleProviderBToggleFinished.promise)
        .mockReturnValueOnce(currentAccountToggleFinished.promise);
      vi.spyOn(useStore.getState(), 'refreshAiModelList').mockResolvedValue();

      useStore.setState({ activeAiProvider: 'provider-a' });
      const staleProviderAToggle = useStore
        .getState()
        .toggleModelEnabled({ enabled: true, id: 'shared-model' });
      useStore.setState({ activeAiProvider: 'provider-b' });
      const staleProviderBToggle = useStore
        .getState()
        .toggleModelEnabled({ enabled: false, id: 'shared-model' });

      useUserStore.setState({
        authUserId: 'account-b',
        ownershipInvalidationGeneration: 1,
        user: { id: 'account-b' },
      });
      useStore.setState({
        activeAiProvider: 'provider-c',
        aiModelLoadingIds: [],
        scopeGeneration: 1,
      });
      const currentAccountToggle = useStore
        .getState()
        .toggleModelEnabled({ enabled: true, id: 'shared-model' });
      expect(useStore.getState().aiModelLoadingIds).toEqual(['shared-model']);

      staleProviderBToggleFinished.resolve();
      await staleProviderBToggle;
      staleProviderAToggleFinished.resolve();
      await staleProviderAToggle;
      expect(useStore.getState().aiModelLoadingIds).toEqual(['shared-model']);

      currentAccountToggleFinished.resolve();
      await currentAccountToggle;
      expect(useStore.getState().aiModelLoadingIds).toEqual([]);
    });

    it('does not clear newer loading state after an A-B-A completion', async () => {
      const toggleFinished = createDeferred<void>();
      vi.spyOn(aiModelService, 'toggleModelEnabled').mockReturnValue(toggleFinished.promise);
      const refreshModels = vi.spyOn(useStore.getState(), 'refreshAiModelList').mockResolvedValue();

      const togglePromise = useStore
        .getState()
        .toggleModelEnabled({ enabled: true, id: 'model-a' });
      expect(useStore.getState().aiModelLoadingIds).toEqual(['model-a']);

      useUserStore.setState({
        authUserId: 'account-b',
        ownershipInvalidationGeneration: 1,
        user: { id: 'account-b' },
      });
      useUserStore.setState({
        authUserId: 'test-user',
        user: { id: 'test-user' },
      });
      useStore.setState({
        aiModelLoadingIds: ['new-account-model'],
        scopeGeneration: 1,
      });
      toggleFinished.resolve();
      await togglePromise;

      expect(refreshModels).not.toHaveBeenCalled();
      expect(useStore.getState().aiModelLoadingIds).toEqual(['new-account-model']);
    });
  });

  describe('updateAiModelsConfig', () => {
    it('should update model config and refresh list', async () => {
      const updateData = {
        displayName: 'Updated Model',
        enabled: true,
      };

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi.spyOn(aiModelService, 'updateAiModel').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.updateAiModelsConfig('model-1', 'test-provider', updateData);
      });

      expect(serviceSpy).toHaveBeenCalledWith('model-1', 'test-provider', updateData);
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('updateAiModelsSort', () => {
    it('should update model sort order and refresh list', async () => {
      const sortMap = [
        { id: 'model-1', sort: 1 },
        { id: 'model-2', sort: 2 },
      ];

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'updateAiModelOrder')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.updateAiModelsSort('test-provider', sortMap);
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider', sortMap);
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('useFetchAiProviderModels', () => {
    it('should fetch provider models and update state', async () => {
      const mockModels: AiProviderModelListItem[] = [
        {
          abilities: {},
          displayName: 'Model 1',
          enabled: true,
          id: 'model-1',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
      ];

      vi.spyOn(aiModelService, 'getAiProviderModelList').mockResolvedValue(mockModels);

      const { result } = renderHook(() =>
        useStore.getState().useFetchAiProviderModels('test-provider'),
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockModels);
      });

      expect(aiModelService.getAiProviderModelList).toHaveBeenCalledWith('test-provider');
    });

    it('should update store state on successful fetch', async () => {
      const mockModels: AiProviderModelListItem[] = [
        {
          abilities: {},
          displayName: 'Model 1',
          enabled: true,
          id: 'model-1',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
      ];

      vi.spyOn(aiModelService, 'getAiProviderModelList').mockResolvedValue(mockModels);

      renderHook(() => useStore.getState().useFetchAiProviderModels('test-provider'));

      await waitFor(() => {
        const state = useStore.getState();
        expect(state.aiProviderModelList).toEqual(mockModels);
        expect(state.isAiModelListInit).toBe(true);
      });
    });

    it('should not update state if data is same and list is already initialized', async () => {
      const mockModels: AiProviderModelListItem[] = [
        {
          abilities: {},
          displayName: 'Model 1',
          enabled: true,
          id: 'model-1',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
      ];

      act(() => {
        useStore.setState({
          aiProviderModelList: mockModels,
          isAiModelListInit: true,
        });
      });

      vi.spyOn(aiModelService, 'getAiProviderModelList').mockResolvedValue(mockModels);

      const setStateSpy = vi.spyOn(useStore, 'setState');

      renderHook(() => useStore.getState().useFetchAiProviderModels('test-provider'));

      await waitFor(() => {
        expect(aiModelService.getAiProviderModelList).toHaveBeenCalled();
      });

      // State should not be updated if data is the same
      expect(setStateSpy).not.toHaveBeenCalled();
    });

    it('should update state if data is different even when initialized', async () => {
      const initialModels: AiProviderModelListItem[] = [
        {
          abilities: {},
          displayName: 'Model 1',
          enabled: true,
          id: 'model-1',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
      ];

      const newModels: AiProviderModelListItem[] = [
        {
          abilities: {},
          displayName: 'Model 2',
          enabled: false,
          id: 'model-2',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
      ];

      act(() => {
        useStore.setState({
          aiProviderModelList: initialModels,
          isAiModelListInit: true,
        });
      });

      vi.spyOn(aiModelService, 'getAiProviderModelList').mockResolvedValue(newModels);

      renderHook(() => useStore.getState().useFetchAiProviderModels('test-provider'));

      await waitFor(() => {
        const state = useStore.getState();
        expect(state.aiProviderModelList).toEqual(newModels);
      });
    });
  });
});
