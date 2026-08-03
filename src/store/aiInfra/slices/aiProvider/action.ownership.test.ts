import { act, renderHook, waitFor } from '@testing-library/react';
import type { AiProviderModelListItem } from 'model-bank';
import { mutate } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiProviderService } from '@/services/aiProvider';
import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import type {
  AiProviderDetailItem,
  AiProviderListItem,
  AiProviderRuntimeState,
} from '@/types/aiProvider';

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

const swrCalls = vi.hoisted(
  () =>
    [] as Array<{
      key: unknown;
      onError?: (_error: Error) => void;
      onSuccess?: (_data: unknown) => void;
    }>,
);

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('swr', () => ({
  mutate: vi.fn(),
}));

vi.mock('@/libs/swr', () => ({
  mutateAccountSWR: (key: unknown) => mutate(key),
  useClientDataSWR: (
    key: unknown,
    _fetcher: unknown,
    options: {
      onError?: (_error: Error) => void;
      onSuccess?: (_data: unknown) => void;
    },
  ) => {
    swrCalls.push({ key, onError: options.onError, onSuccess: options.onSuccess });
    return { data: undefined };
  },
}));

const createRuntimeState = (
  apiKey: string,
): AiProviderRuntimeState & {
  builtinAiModelList: [];
} => ({
  builtinAiModelList: [],
  enabledAiModels: [],
  enabledAiProviders: [],
  enabledChatAiProviders: [],
  enabledImageAiProviders: [],
  runtimeConfig: {
    openai: {
      keyVaults: { apiKey },
      settings: {},
    },
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI provider runtime ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    swrCalls.length = 0;
    useUserStore.setState({
      authUserId: 'account-a',
      isLoaded: true,
      isSignedIn: true,
      ownershipInvalidationGeneration: 0,
      user: { id: 'account-a' },
      userStateInitializationFailure: undefined,
    });
    useAiInfraStore.setState({
      activeAiProvider: undefined,
      aiProviderConfigUpdatingIds: [],
      aiProviderDetail: undefined,
      aiProviderList: [],
      aiProviderLoadingIds: [],
      aiProviderModelList: [],
      aiProviderRuntimeConfig: {},
      enabledAiModels: undefined,
      enabledAiProviders: undefined,
      enabledChatModelList: [],
      enabledImageModelList: [],
      initAiProviderList: false,
      isAiModelListInit: false,
      isInitAiProviderRuntimeState: false,
      runtimeStateInitializationFailure: undefined,
      runtimeStateRequestScope: undefined,
      runtimeStateScope: undefined,
      scopeGeneration: 0,
    });
  });

  it('keys runtime state by account and ignores an earlier account response', async () => {
    const { rerender } = renderHook(
      ({ scope }: { scope: string | undefined }) => {
        useAiInfraStore.getState().useFetchAiProviderRuntimeState(true, scope);
        useAiInfraStore.getState().useFetchAiProviderList();
        useAiInfraStore.getState().useFetchAiProviderItem('openai');
        useAiInfraStore.getState().useFetchAiProviderModels('openai');
      },
      { initialProps: { scope: 'user:account-a' as string | undefined } },
    );

    await waitFor(() => {
      expect(useAiInfraStore.getState().runtimeStateRequestScope).toBe('user:account-a');
    });
    const accountACall = swrCalls.find(
      ({ key }) => Array.isArray(key) && key[1] === 'user:account-a',
    );
    expect(accountACall?.key).toEqual(['FETCH_AI_PROVIDER_RUNTIME_STATE', 'user:account-a']);

    act(() => {
      accountACall?.onSuccess?.(createRuntimeState('account-a-secret'));
    });
    expect(useAiInfraStore.getState().runtimeStateScope).toBe('user:account-a');

    const accountAProviderListCall = swrCalls.find(
      ({ key }) =>
        Array.isArray(key) && key[0] === 'FETCH_AI_PROVIDER' && key[1] === 'user:account-a',
    );
    const accountAProviderItemCall = swrCalls.find(
      ({ key }) =>
        Array.isArray(key) && key[0] === 'FETCH_AI_PROVIDER_ITEM' && key[1] === 'user:account-a',
    );
    const accountAModelListCall = swrCalls.find(
      ({ key }) =>
        Array.isArray(key) && key[0] === 'FETCH_AI_PROVIDER_MODELS' && key[1] === 'user:account-a',
    );
    const accountAProviderList = [{ id: 'account-a-provider' }] as AiProviderListItem[];
    const accountAProviderDetail = {
      id: 'openai',
      keyVaults: { apiKey: 'account-a-detail-secret' },
    } as AiProviderDetailItem;
    const accountAModelList = [{ id: 'account-a-model' }] as AiProviderModelListItem[];
    act(() => {
      accountAProviderListCall?.onSuccess?.(accountAProviderList);
      accountAProviderItemCall?.onSuccess?.(accountAProviderDetail);
      accountAModelListCall?.onSuccess?.(accountAModelList);
    });

    expect(useAiInfraStore.getState().aiProviderList).toEqual(accountAProviderList);
    expect(useAiInfraStore.getState().aiProviderDetail).toEqual(accountAProviderDetail);
    expect(useAiInfraStore.getState().aiProviderModelList).toEqual(accountAModelList);

    act(() => {
      useUserStore.setState({ authUserId: undefined, isLoaded: false, user: undefined });
    });
    rerender({ scope: undefined });
    await waitFor(() => {
      expect(useAiInfraStore.getState().runtimeStateRequestScope).toBeUndefined();
      expect(useAiInfraStore.getState().aiProviderRuntimeConfig).toEqual({});
      expect(useAiInfraStore.getState().aiProviderList).toEqual([]);
      expect(useAiInfraStore.getState().aiProviderDetail).toBeUndefined();
      expect(useAiInfraStore.getState().aiProviderModelList).toEqual([]);
      expect(useAiInfraStore.getState().isInitAiProviderRuntimeState).toBe(false);
    });

    act(() => {
      useUserStore.setState({
        authUserId: 'account-b',
        isLoaded: true,
        user: { id: 'account-b' },
      });
    });
    rerender({ scope: 'user:account-b' });
    await waitFor(() => {
      expect(useAiInfraStore.getState().runtimeStateRequestScope).toBe('user:account-b');
      expect(useAiInfraStore.getState().aiProviderRuntimeConfig).toEqual({});
      expect(useAiInfraStore.getState().isInitAiProviderRuntimeState).toBe(false);
    });

    const accountBCall = swrCalls.find(
      ({ key }) =>
        Array.isArray(key) &&
        key[0] === 'FETCH_AI_PROVIDER_RUNTIME_STATE' &&
        key[1] === 'user:account-b',
    );
    act(() => {
      accountACall?.onSuccess?.(createRuntimeState('stale-account-a-secret'));
      accountAProviderListCall?.onSuccess?.(accountAProviderList);
      accountAProviderItemCall?.onSuccess?.(accountAProviderDetail);
      accountAModelListCall?.onSuccess?.(accountAModelList);
    });
    expect(useAiInfraStore.getState().aiProviderRuntimeConfig).toEqual({});
    expect(useAiInfraStore.getState().aiProviderList).toEqual([]);
    expect(useAiInfraStore.getState().aiProviderDetail).toBeUndefined();
    expect(useAiInfraStore.getState().aiProviderModelList).toEqual([]);

    act(() => {
      accountBCall?.onSuccess?.(createRuntimeState('account-b-secret'));
    });
    expect(useAiInfraStore.getState().runtimeStateScope).toBe('user:account-b');
    expect(useAiInfraStore.getState().aiProviderRuntimeConfig.openai.keyVaults.apiKey).toBe(
      'account-b-secret',
    );
  });

  it('records active-scope failures and retries before first hydration', async () => {
    renderHook(() =>
      useAiInfraStore
        .getState()
        .useFetchAiProviderRuntimeState(true, 'user:account-a'),
    );

    const runtimeCall = swrCalls.find(
      ({ key }) =>
        Array.isArray(key) &&
        key[0] === 'FETCH_AI_PROVIDER_RUNTIME_STATE' &&
        key[1] === 'user:account-a',
    );

    act(() => {
      runtimeCall?.onError?.(new Error('request failed'));
    });

    expect(useAiInfraStore.getState().runtimeStateInitializationFailure).toEqual({
      reason: 'request-failed',
      scope: 'user:account-a',
    });

    await act(async () => {
      await useAiInfraStore.getState().refreshAiProviderRuntimeState();
    });

    expect(mutate).toHaveBeenCalledWith([
      'FETCH_AI_PROVIDER_RUNTIME_STATE',
      'user:account-a',
    ]);
    expect(useAiInfraStore.getState().runtimeStateInitializationFailure).toBeUndefined();
  });

  it('clears an active-scope failure after successful hydration', () => {
    useAiInfraStore.setState({
      runtimeStateInitializationFailure: {
        reason: 'request-failed',
        scope: 'user:account-a',
      },
    });

    renderHook(() =>
      useAiInfraStore
        .getState()
        .useFetchAiProviderRuntimeState(true, 'user:account-a'),
    );

    const runtimeCall = swrCalls.find(
      ({ key }) =>
        Array.isArray(key) &&
        key[0] === 'FETCH_AI_PROVIDER_RUNTIME_STATE' &&
        key[1] === 'user:account-a',
    );

    act(() => {
      runtimeCall?.onSuccess?.(createRuntimeState('account-a-secret'));
    });

    expect(useAiInfraStore.getState().isInitAiProviderRuntimeState).toBe(true);
    expect(useAiInfraStore.getState().runtimeStateInitializationFailure).toBeUndefined();
  });

  it('ignores a captured runtime response after active-scope ownership is invalidated', () => {
    renderHook(() =>
      useAiInfraStore
        .getState()
        .useFetchAiProviderRuntimeState(true, 'user:account-a'),
    );

    const runtimeCall = swrCalls.find(
      ({ key }) =>
        Array.isArray(key) &&
        key[0] === 'FETCH_AI_PROVIDER_RUNTIME_STATE' &&
        key[1] === 'user:account-a',
    );

    act(() => {
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'user:account-a',
        },
      });
      runtimeCall?.onSuccess?.(createRuntimeState('mismatched-account-secret'));
    });

    expect(useAiInfraStore.getState().aiProviderRuntimeConfig).toEqual({});
    expect(useAiInfraStore.getState().isInitAiProviderRuntimeState).toBe(false);
    expect(useAiInfraStore.getState().runtimeStateScope).toBeUndefined();
  });

  it('preserves settled current-scope runtime state when a later refresh fails', () => {
    const settledRuntimeState = createRuntimeState('account-a-secret');
    useAiInfraStore.setState({
      aiProviderRuntimeConfig: settledRuntimeState.runtimeConfig,
      isInitAiProviderRuntimeState: true,
      runtimeStateRequestScope: 'user:account-a',
      runtimeStateScope: 'user:account-a',
    });

    renderHook(() =>
      useAiInfraStore.getState().useFetchAiProviderRuntimeState(true, 'user:account-a'),
    );

    const runtimeCall = swrCalls.find(
      ({ key }) =>
        Array.isArray(key) &&
        key[0] === 'FETCH_AI_PROVIDER_RUNTIME_STATE' &&
        key[1] === 'user:account-a',
    );

    act(() => {
      runtimeCall?.onError?.(new Error('refresh failed'));
    });

    const runtimeState = useAiInfraStore.getState();
    expect(runtimeState.aiProviderRuntimeConfig.openai.keyVaults.apiKey).toBe(
      'account-a-secret',
    );
    expect(runtimeState.isInitAiProviderRuntimeState).toBe(true);
    expect(runtimeState.runtimeStateInitializationFailure).toBeUndefined();
    expect(runtimeState.runtimeStateScope).toBe('user:account-a');
  });

  it('ignores runtime failures from a stale account request', async () => {
    const { rerender } = renderHook(
      ({ scope }) =>
        useAiInfraStore.getState().useFetchAiProviderRuntimeState(true, scope),
      { initialProps: { scope: 'user:account-a' as string | undefined } },
    );

    const accountACall = swrCalls.find(
      ({ key }) =>
        Array.isArray(key) &&
        key[0] === 'FETCH_AI_PROVIDER_RUNTIME_STATE' &&
        key[1] === 'user:account-a',
    );

    act(() => {
      useUserStore.setState({ authUserId: 'account-b', user: { id: 'account-b' } });
    });
    rerender({ scope: 'user:account-b' });

    act(() => {
      accountACall?.onError?.(new Error('stale request failed'));
    });

    expect(useAiInfraStore.getState().runtimeStateInitializationFailure).toBeUndefined();
  });
});

describe('AI provider mutation ownership', () => {
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
    useAiInfraStore.setState({
      activeAiProvider: 'active-provider',
      aiProviderConfigUpdatingIds: [],
      aiProviderLoadingIds: [],
      scopeGeneration: 0,
    });
  });

  it('blocks every provider persistence action during an active owner mismatch', async () => {
    const createProvider = vi.spyOn(aiProviderService, 'createAiProvider');
    const deleteProvider = vi.spyOn(aiProviderService, 'deleteAiProvider');
    const toggleProvider = vi.spyOn(aiProviderService, 'toggleProviderEnabled');
    const updateProvider = vi.spyOn(aiProviderService, 'updateAiProvider');
    const updateProviderConfig = vi.spyOn(aiProviderService, 'updateAiProviderConfig');
    const updateProviderOrder = vi.spyOn(aiProviderService, 'updateAiProviderOrder');
    useUserStore.setState({
      ownershipInvalidationGeneration: 1,
      userStateInitializationFailure: {
        reason: 'owner-mismatch',
        scope: 'user:account-a',
      },
    });

    const store = useAiInfraStore.getState();
    await store.createNewAiProvider({
      id: 'custom-provider',
      name: 'Custom Provider',
      source: 'custom',
    });
    await store.deleteAiProvider('provider-delete');
    await store.removeAiProvider('provider-remove');
    await store.toggleProviderEnabled('provider-toggle', true);
    await store.updateAiProvider('provider-update', { name: 'Updated Provider' });
    await store.updateAiProviderConfig('provider-config', { config: {} });
    await store.updateAiProviderSort([{ id: 'provider-sort', sort: 1 }]);

    expect(createProvider).not.toHaveBeenCalled();
    expect(deleteProvider).not.toHaveBeenCalled();
    expect(toggleProvider).not.toHaveBeenCalled();
    expect(updateProvider).not.toHaveBeenCalled();
    expect(updateProviderConfig).not.toHaveBeenCalled();
    expect(updateProviderOrder).not.toHaveBeenCalled();
    expect(useAiInfraStore.getState().aiProviderLoadingIds).toEqual([]);
    expect(useAiInfraStore.getState().aiProviderConfigUpdatingIds).toEqual([]);
  });

  it('quarantines an A-B-A provider completion without stale loading cleanup', async () => {
    const updateFinished = createDeferred<void>();
    vi.spyOn(aiProviderService, 'updateAiProvider').mockReturnValue(updateFinished.promise);
    const refreshList = vi
      .spyOn(useAiInfraStore.getState(), 'refreshAiProviderList')
      .mockResolvedValue();
    const refreshDetail = vi
      .spyOn(useAiInfraStore.getState(), 'refreshAiProviderDetail')
      .mockResolvedValue();

    const updatePromise = useAiInfraStore
      .getState()
      .updateAiProvider('provider-a', { name: 'Account A Provider' });
    expect(useAiInfraStore.getState().aiProviderLoadingIds).toEqual(['provider-a']);

    useUserStore.setState({
      authUserId: 'account-b',
      ownershipInvalidationGeneration: 1,
      user: { id: 'account-b' },
    });
    useUserStore.setState({
      authUserId: 'account-a',
      user: { id: 'account-a' },
    });
    useAiInfraStore.setState({
      aiProviderLoadingIds: ['new-account-provider'],
      scopeGeneration: 1,
    });
    updateFinished.resolve();
    await updatePromise;

    expect(refreshList).not.toHaveBeenCalled();
    expect(refreshDetail).not.toHaveBeenCalled();
    expect(useAiInfraStore.getState().aiProviderLoadingIds).toEqual(['new-account-provider']);
  });

  it('keeps provider loading until every overlapping owned operation completes', async () => {
    const firstToggleFinished = createDeferred<void>();
    const secondToggleFinished = createDeferred<void>();
    vi.spyOn(aiProviderService, 'toggleProviderEnabled')
      .mockReturnValueOnce(firstToggleFinished.promise)
      .mockReturnValueOnce(secondToggleFinished.promise);
    vi.spyOn(useAiInfraStore.getState(), 'refreshAiProviderList').mockResolvedValue();

    const firstToggle = useAiInfraStore
      .getState()
      .toggleProviderEnabled('provider-overlap', true);
    const secondToggle = useAiInfraStore
      .getState()
      .toggleProviderEnabled('provider-overlap', false);
    expect(useAiInfraStore.getState().aiProviderLoadingIds).toEqual(['provider-overlap']);

    firstToggleFinished.resolve();
    await firstToggle;
    expect(useAiInfraStore.getState().aiProviderLoadingIds).toEqual(['provider-overlap']);

    secondToggleFinished.resolve();
    await secondToggle;
    expect(useAiInfraStore.getState().aiProviderLoadingIds).toEqual([]);
  });

  it('keeps an explicit provider target valid when the active provider changes', async () => {
    const updateFinished = createDeferred<void>();
    vi.spyOn(aiProviderService, 'updateAiProvider').mockReturnValue(updateFinished.promise);
    const refreshList = vi
      .spyOn(useAiInfraStore.getState(), 'refreshAiProviderList')
      .mockResolvedValue();
    const refreshDetail = vi
      .spyOn(useAiInfraStore.getState(), 'refreshAiProviderDetail')
      .mockResolvedValue();

    const updatePromise = useAiInfraStore
      .getState()
      .updateAiProvider('provider-explicit', { name: 'Explicit Provider' });
    useAiInfraStore.setState({ activeAiProvider: 'provider-unrelated' });
    updateFinished.resolve();
    await updatePromise;

    expect(refreshList).toHaveBeenCalledTimes(1);
    expect(refreshDetail).toHaveBeenCalledWith('provider-explicit');
    expect(useAiInfraStore.getState().aiProviderLoadingIds).toEqual([]);
  });
});
