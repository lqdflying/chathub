import isEqual from 'fast-deep-equal';
import {
  AiModelSortMap,
  AiProviderModelListItem,
  CreateAiModelParams,
  ToggleAiModelEnableParams,
} from 'model-bank';
import { SWRResponse, mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { aiModelService } from '@/services/aiModel';
import { AiInfraStore } from '@/store/aiInfra/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const FETCH_AI_PROVIDER_MODEL_LIST_KEY = 'FETCH_AI_PROVIDER_MODELS';

export interface AiModelAction {
  batchToggleAiModels: (ids: string[], enabled: boolean) => Promise<void>;
  batchUpdateAiModels: (models: AiProviderModelListItem[], providerId?: string) => Promise<void>;
  clearModelsByProvider: (provider: string) => Promise<void>;
  clearRemoteModels: (provider: string) => Promise<void>;
  createNewAiModel: (params: CreateAiModelParams) => Promise<void>;
  fetchRemoteModelList: (providerId: string) => Promise<void>;
  internal_toggleAiModelLoading: (id: string, loading: boolean) => void;

  refreshAiModelList: (providerId?: string) => Promise<void>;
  removeAiModel: (id: string, providerId: string) => Promise<void>;
  toggleModelEnabled: (params: Omit<ToggleAiModelEnableParams, 'providerId'>) => Promise<void>;
  updateAiModelsConfig: (
    id: string,
    providerId: string,
    data: Partial<AiProviderModelListItem>,
  ) => Promise<void>;
  updateAiModelsSort: (providerId: string, items: AiModelSortMap[]) => Promise<void>;

  useFetchAiProviderModels: (id: string) => SWRResponse<AiProviderModelListItem[]>;
}

export const createAiModelSlice: StateCreator<
  AiInfraStore,
  [['zustand/devtools', never]],
  [],
  AiModelAction
> = (set, get) => ({
  batchToggleAiModels: async (ids, enabled) => {
    const { activeAiProvider } = get();
    if (!activeAiProvider) return;

    await aiModelService.batchToggleAiModels(activeAiProvider, ids, enabled);
    await get().refreshAiModelList(activeAiProvider);
  },
  batchUpdateAiModels: async (models, providerId) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    const targetProviderId = providerId ?? get().activeAiProvider;
    if (!requestedScope || !targetProviderId) return;

    await aiModelService.batchUpdateAiModels(targetProviderId, models);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshAiModelList(targetProviderId);
  },
  clearModelsByProvider: async (provider) => {
    await aiModelService.clearModelsByProvider(provider);
    await get().refreshAiModelList();
  },
  clearRemoteModels: async (provider) => {
    await aiModelService.clearRemoteModels(provider);
    await get().refreshAiModelList();
  },
  createNewAiModel: async (data) => {
    await aiModelService.createAiModel(data);
    await get().refreshAiModelList();
  },
  fetchRemoteModelList: async (providerId) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    const { modelsService } = await import('@/services/models');
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    const data = await modelsService.getModels(providerId);
    if (
      data &&
      authSelectors.currentUserScope(useUserStore.getState()) === requestedScope &&
      get().scopeGeneration === requestedGeneration
    ) {
      const remoteModels = data.map((model) => ({
        ...model,
        abilities: {
          files: model.files,
          functionCall: model.functionCall,
          imageOutput: model.imageOutput,
          reasoning: model.reasoning,
          search: model.search,
          video: model.video,
          vision: model.vision,
        },
        enabled: model.enabled || false,
        source: 'remote' as const,
        type: model.type || 'chat',
      }));

      await aiModelService.batchUpdateAiModels(
        providerId,
        remoteModels,
      );

      if (
        authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
        get().scopeGeneration !== requestedGeneration
      )
        return;

      await get().refreshAiModelList(providerId);
    }
  },
  internal_toggleAiModelLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) return { aiModelLoadingIds: [...state.aiModelLoadingIds, id] };

        return { aiModelLoadingIds: state.aiModelLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleAiModelLoading',
    );
  },
  refreshAiModelList: async (providerId) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    const targetProviderId = providerId ?? get().activeAiProvider;
    if (!requestedScope || !targetProviderId) return;

    await mutate([FETCH_AI_PROVIDER_MODEL_LIST_KEY, requestedScope, targetProviderId]);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    // make refresh provide runtime state async, not block
    get().refreshAiProviderRuntimeState();
  },
  removeAiModel: async (id, providerId) => {
    await aiModelService.deleteAiModel({ id, providerId });
    await get().refreshAiModelList();
  },
  toggleModelEnabled: async (params) => {
    const { activeAiProvider } = get();
    if (!activeAiProvider) return;

    get().internal_toggleAiModelLoading(params.id, true);

    await aiModelService.toggleModelEnabled({ ...params, providerId: activeAiProvider });
    await get().refreshAiModelList();

    get().internal_toggleAiModelLoading(params.id, false);
  },

  updateAiModelsConfig: async (id, providerId, data) => {
    await aiModelService.updateAiModel(id, providerId, data);
    await get().refreshAiModelList();
  },
  updateAiModelsSort: async (id, items) => {
    await aiModelService.updateAiModelOrder(id, items);
    await get().refreshAiModelList();
  },

  useFetchAiProviderModels: (id) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);
    const hasOwnerMismatch = useUserStore(authSelectors.hasActiveUserStateOwnerMismatch);

    return useClientDataSWR<AiProviderModelListItem[]>(
      requestedScope && !hasOwnerMismatch
        ? [FETCH_AI_PROVIDER_MODEL_LIST_KEY, requestedScope, id]
        : null,
      () => aiModelService.getAiProviderModelList(id),
      {
        onSuccess: (data) => {
          const userState = useUserStore.getState();
          if (authSelectors.currentUserScope(userState) !== requestedScope) return;
          if (authSelectors.hasActiveUserStateOwnerMismatch(userState)) return;

          // no need to update list if the list have been init and data is the same
          if (get().isAiModelListInit && isEqual(data, get().aiProviderModelList)) return;

          set(
            { aiProviderModelList: data, isAiModelListInit: true },
            false,
            `useFetchAiProviderModels/${id}`,
          );
        },
      },
    );
  },
});
