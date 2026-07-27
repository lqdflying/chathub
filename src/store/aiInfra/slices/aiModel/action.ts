import isEqual from 'fast-deep-equal';
import {
  AiModelSortMap,
  AiProviderModelListItem,
  CreateAiModelParams,
  ToggleAiModelEnableParams,
} from 'model-bank';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { aiModelService } from '@/services/aiModel';
import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import type { AccountMutationSnapshot } from '@/store/accountMutation';
import { AiInfraStore } from '@/store/aiInfra/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const FETCH_AI_PROVIDER_MODEL_LIST_KEY = 'FETCH_AI_PROVIDER_MODELS';

interface AiModelMutationCheckpoint {
  accountMutationSnapshot: AccountMutationSnapshot;
  modelTarget: string;
  providerTarget: string;
  scopeGeneration: number;
}

interface AiModelLoadingOperations {
  accountMutationSnapshot: AccountMutationSnapshot;
  markerOwner: AiModelLoadingMarkerOwner;
  operationIds: Set<symbol>;
  scopeGeneration: number;
}

interface AiModelLoadingMarkerOwner {
  accountMutationSnapshot: AccountMutationSnapshot;
  operationBucketCount: number;
  scopeGeneration: number;
  wasLoading: boolean;
}

const aiModelLoadingOperations = new Map<string, Map<string, AiModelLoadingOperations>>();
const aiModelLoadingMarkerOwners = new Map<string, AiModelLoadingMarkerOwner>();

const captureAiModelMutationCheckpoint = (
  get: () => AiInfraStore,
  providerTarget: string,
  modelTarget: string,
): AiModelMutationCheckpoint | undefined => {
  const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
  if (!accountMutationSnapshot || !providerTarget || !modelTarget) return;

  return {
    accountMutationSnapshot,
    modelTarget,
    providerTarget,
    scopeGeneration: get().scopeGeneration,
  };
};

const isAiModelMutationCurrent = (
  get: () => AiInfraStore,
  checkpoint: AiModelMutationCheckpoint,
): boolean =>
  isAccountMutationCurrent(useUserStore.getState(), checkpoint.accountMutationSnapshot) &&
  get().scopeGeneration === checkpoint.scopeGeneration;

const isSameAccountMutationSnapshot = (
  firstSnapshot: AccountMutationSnapshot,
  secondSnapshot: AccountMutationSnapshot,
): boolean =>
  firstSnapshot.scope === secondSnapshot.scope &&
  firstSnapshot.ownershipInvalidationGeneration ===
    secondSnapshot.ownershipInvalidationGeneration;

const beginAiModelLoading = (
  get: () => AiInfraStore,
  checkpoint: AiModelMutationCheckpoint,
): symbol => {
  const operationId = Symbol(checkpoint.modelTarget);
  const operationsByModel = aiModelLoadingOperations.get(checkpoint.providerTarget);
  const existingOperations = operationsByModel?.get(checkpoint.modelTarget);

  if (
    existingOperations?.scopeGeneration === checkpoint.scopeGeneration &&
    isSameAccountMutationSnapshot(
      existingOperations.accountMutationSnapshot,
      checkpoint.accountMutationSnapshot,
    )
  ) {
    existingOperations.operationIds.add(operationId);
    return operationId;
  }

  const existingMarkerOwner = aiModelLoadingMarkerOwners.get(checkpoint.modelTarget);
  const markerOwner =
    existingMarkerOwner?.scopeGeneration === checkpoint.scopeGeneration &&
    isSameAccountMutationSnapshot(
      existingMarkerOwner.accountMutationSnapshot,
      checkpoint.accountMutationSnapshot,
    )
      ? existingMarkerOwner
      : {
          accountMutationSnapshot: checkpoint.accountMutationSnapshot,
          operationBucketCount: 0,
          scopeGeneration: checkpoint.scopeGeneration,
          wasLoading: get().aiModelLoadingIds.includes(checkpoint.modelTarget),
        };

  if (markerOwner !== existingMarkerOwner) {
    aiModelLoadingMarkerOwners.set(checkpoint.modelTarget, markerOwner);
    get().internal_toggleAiModelLoading(checkpoint.modelTarget, true);
  }
  markerOwner.operationBucketCount += 1;

  const providerOperations = operationsByModel ?? new Map<string, AiModelLoadingOperations>();
  providerOperations.set(checkpoint.modelTarget, {
    accountMutationSnapshot: checkpoint.accountMutationSnapshot,
    markerOwner,
    operationIds: new Set([operationId]),
    scopeGeneration: checkpoint.scopeGeneration,
  });
  if (!operationsByModel) {
    aiModelLoadingOperations.set(checkpoint.providerTarget, providerOperations);
  }

  return operationId;
};

const finalizeAiModelLoading = (
  get: () => AiInfraStore,
  checkpoint: AiModelMutationCheckpoint,
  operationId: symbol,
): void => {
  const operationsByModel = aiModelLoadingOperations.get(checkpoint.providerTarget);
  const operations = operationsByModel?.get(checkpoint.modelTarget);
  if (
    !operations ||
    operations.scopeGeneration !== checkpoint.scopeGeneration ||
    !isSameAccountMutationSnapshot(
      operations.accountMutationSnapshot,
      checkpoint.accountMutationSnapshot,
    ) ||
    !operations.operationIds.delete(operationId)
  )
    return;

  if (operations.operationIds.size > 0) return;

  operationsByModel.delete(checkpoint.modelTarget);
  if (operationsByModel.size === 0) {
    aiModelLoadingOperations.delete(checkpoint.providerTarget);
  }

  operations.markerOwner.operationBucketCount -= 1;
  if (operations.markerOwner.operationBucketCount > 0) return;
  if (aiModelLoadingMarkerOwners.get(checkpoint.modelTarget) !== operations.markerOwner) return;

  aiModelLoadingMarkerOwners.delete(checkpoint.modelTarget);
  if (!isAiModelMutationCurrent(get, checkpoint)) return;

  get().internal_toggleAiModelLoading(checkpoint.modelTarget, operations.markerOwner.wasLoading);
};

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
    const targetProviderId = get().activeAiProvider;
    if (!targetProviderId) return;
    const checkpoint = captureAiModelMutationCheckpoint(
      get,
      targetProviderId,
      ids.join(',') || 'batch-toggle',
    );
    if (!checkpoint || !isAiModelMutationCurrent(get, checkpoint)) return;

    await aiModelService.batchToggleAiModels(targetProviderId, ids, enabled);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;

    await get().refreshAiModelList(targetProviderId);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;
  },
  batchUpdateAiModels: async (models, providerId) => {
    const targetProviderId = providerId ?? get().activeAiProvider;
    if (!targetProviderId) return;
    const checkpoint = captureAiModelMutationCheckpoint(
      get,
      targetProviderId,
      models.map(({ id }) => id).join(',') || 'batch-update',
    );
    if (!checkpoint || !isAiModelMutationCurrent(get, checkpoint)) return;

    await aiModelService.batchUpdateAiModels(targetProviderId, models);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;

    await get().refreshAiModelList(targetProviderId);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;
  },
  clearModelsByProvider: async (provider) => {
    const checkpoint = captureAiModelMutationCheckpoint(get, provider, 'all-models');
    if (!checkpoint || !isAiModelMutationCurrent(get, checkpoint)) return;

    await aiModelService.clearModelsByProvider(provider);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;

    await get().refreshAiModelList(provider);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;
  },
  clearRemoteModels: async (provider) => {
    const checkpoint = captureAiModelMutationCheckpoint(get, provider, 'remote-models');
    if (!checkpoint || !isAiModelMutationCurrent(get, checkpoint)) return;

    await aiModelService.clearRemoteModels(provider);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;

    await get().refreshAiModelList(provider);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;
  },
  createNewAiModel: async (data) => {
    const checkpoint = captureAiModelMutationCheckpoint(get, data.providerId, data.id);
    if (!checkpoint || !isAiModelMutationCurrent(get, checkpoint)) return;

    await aiModelService.createAiModel(data);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;

    await get().refreshAiModelList(data.providerId);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;
  },
  fetchRemoteModelList: async (providerId) => {
    const checkpoint = captureAiModelMutationCheckpoint(get, providerId, 'remote-models');
    if (!checkpoint || !isAiModelMutationCurrent(get, checkpoint)) return;

    const { modelsService } = await import('@/services/models');
    if (!isAiModelMutationCurrent(get, checkpoint)) return;

    const data = await modelsService.getModels(providerId);
    if (!isAiModelMutationCurrent(get, checkpoint) || !data) return;

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

    if (!isAiModelMutationCurrent(get, checkpoint)) return;
    await aiModelService.batchUpdateAiModels(providerId, remoteModels);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;

    await get().refreshAiModelList(providerId);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;
  },
  internal_toggleAiModelLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) {
          if (state.aiModelLoadingIds.includes(id)) return state;

          return { aiModelLoadingIds: [...state.aiModelLoadingIds, id] };
        }

        return { aiModelLoadingIds: state.aiModelLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleAiModelLoading',
    );
  },
  refreshAiModelList: async (providerId) => {
    const targetProviderId = providerId ?? get().activeAiProvider;
    if (!targetProviderId) return;
    const checkpoint = captureAiModelMutationCheckpoint(get, targetProviderId, 'model-list');
    if (!checkpoint || !isAiModelMutationCurrent(get, checkpoint)) return;

    await mutateAccountSWR([
      FETCH_AI_PROVIDER_MODEL_LIST_KEY,
      checkpoint.accountMutationSnapshot.scope,
      targetProviderId,
    ]);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;

    // make refresh provide runtime state async, not block
    get().refreshAiProviderRuntimeState();
  },
  removeAiModel: async (id, providerId) => {
    const checkpoint = captureAiModelMutationCheckpoint(get, providerId, id);
    if (!checkpoint || !isAiModelMutationCurrent(get, checkpoint)) return;

    await aiModelService.deleteAiModel({ id, providerId });
    if (!isAiModelMutationCurrent(get, checkpoint)) return;

    await get().refreshAiModelList(providerId);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;
  },
  toggleModelEnabled: async (params) => {
    const targetProviderId = get().activeAiProvider;
    if (!targetProviderId) return;
    const checkpoint = captureAiModelMutationCheckpoint(get, targetProviderId, params.id);
    if (!checkpoint || !isAiModelMutationCurrent(get, checkpoint)) return;
    const loadingOperationId = beginAiModelLoading(get, checkpoint);

    try {
      if (!isAiModelMutationCurrent(get, checkpoint)) return;
      await aiModelService.toggleModelEnabled({ ...params, providerId: targetProviderId });
      if (!isAiModelMutationCurrent(get, checkpoint)) return;

      await get().refreshAiModelList(targetProviderId);
      if (!isAiModelMutationCurrent(get, checkpoint)) return;
    } finally {
      finalizeAiModelLoading(get, checkpoint, loadingOperationId);
    }
  },

  updateAiModelsConfig: async (id, providerId, data) => {
    const checkpoint = captureAiModelMutationCheckpoint(get, providerId, id);
    if (!checkpoint || !isAiModelMutationCurrent(get, checkpoint)) return;

    await aiModelService.updateAiModel(id, providerId, data);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;

    await get().refreshAiModelList(providerId);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;
  },
  updateAiModelsSort: async (providerId, items) => {
    const checkpoint = captureAiModelMutationCheckpoint(
      get,
      providerId,
      items.map(({ id }) => id).join(',') || 'model-sort',
    );
    if (!checkpoint || !isAiModelMutationCurrent(get, checkpoint)) return;

    await aiModelService.updateAiModelOrder(providerId, items);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;

    await get().refreshAiModelList(providerId);
    if (!isAiModelMutationCurrent(get, checkpoint)) return;
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
