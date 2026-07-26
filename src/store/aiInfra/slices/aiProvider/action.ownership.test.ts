import { act, renderHook, waitFor } from '@testing-library/react';
import type { AiProviderModelListItem } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import type {
  AiProviderDetailItem,
  AiProviderListItem,
  AiProviderRuntimeState,
} from '@/types/aiProvider';

const swrCalls = vi.hoisted(
  () =>
    [] as Array<{
      key: unknown;
      onSuccess?: (data: unknown) => void;
    }>,
);

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lobechat/const')>()),
  isDeprecatedEdition: false,
  isDesktop: false,
  isUsePgliteDB: false,
}));

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (
    key: unknown,
    _fetcher: unknown,
    options: {
      onSuccess?: (data: unknown) => void;
    },
  ) => {
    swrCalls.push({ key, onSuccess: options.onSuccess });
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

describe('AI provider runtime ownership', () => {
  beforeEach(() => {
    swrCalls.length = 0;
    useUserStore.setState({
      authUserId: 'account-a',
      isLoaded: true,
      isSignedIn: true,
      user: { id: 'account-a' },
    });
    useAiInfraStore.setState({
      activeAiProvider: undefined,
      aiProviderDetail: undefined,
      aiProviderList: [],
      aiProviderModelList: [],
      aiProviderRuntimeConfig: {},
      enabledAiModels: undefined,
      enabledAiProviders: undefined,
      enabledChatModelList: [],
      enabledImageModelList: [],
      initAiProviderList: false,
      isAiModelListInit: false,
      isInitAiProviderRuntimeState: false,
      runtimeStateRequestScope: undefined,
      runtimeStateScope: undefined,
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
});
