import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { knowledgeBaseService } from '@/services/knowledgeBase';
import type { AccountMutationSnapshot } from '@/store/accountMutation';
import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { KnowledgeBaseStore } from '@/store/knowledgeBase/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { CreateKnowledgeBaseParams, KnowledgeBaseItem } from '@/types/knowledgeBase';

const FETCH_KNOWLEDGE_BASE_LIST_KEY = 'FETCH_KNOWLEDGE_BASE';
const FETCH_KNOWLEDGE_BASE_ITEM_KEY = 'FETCH_KNOWLEDGE_BASE_ITEM';

interface KnowledgeBaseUpdateLoadingOperations {
  operationIds: Set<symbol>;
  scopeGeneration: number;
  wasLoading: boolean;
}

const knowledgeBaseUpdateLoadingOperations = new Map<
  string,
  KnowledgeBaseUpdateLoadingOperations
>();

export interface KnowledgeBaseMutationCheckpoint {
  accountMutationSnapshot: AccountMutationSnapshot;
  scopeGeneration: number;
}

const captureKnowledgeBaseMutationCheckpoint = (
  get: () => KnowledgeBaseStore,
): KnowledgeBaseMutationCheckpoint | undefined => {
  const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
  if (!accountMutationSnapshot) return;

  return {
    accountMutationSnapshot,
    scopeGeneration: get().scopeGeneration,
  };
};

const isKnowledgeBaseMutationCurrent = (
  get: () => KnowledgeBaseStore,
  checkpoint: KnowledgeBaseMutationCheckpoint,
): boolean =>
  isAccountMutationCurrent(useUserStore.getState(), checkpoint.accountMutationSnapshot) &&
  get().scopeGeneration === checkpoint.scopeGeneration;

const beginKnowledgeBaseUpdateLoading = (
  get: () => KnowledgeBaseStore,
  id: string,
  scopeGeneration: number,
): symbol => {
  const operationId = Symbol(id);
  const existingOperations = knowledgeBaseUpdateLoadingOperations.get(id);

  if (existingOperations?.scopeGeneration === scopeGeneration) {
    existingOperations.operationIds.add(operationId);
    return operationId;
  }

  knowledgeBaseUpdateLoadingOperations.set(id, {
    operationIds: new Set([operationId]),
    scopeGeneration,
    wasLoading: get().knowledgeBaseLoadingIds.includes(id),
  });
  get().internal_toggleKnowledgeBaseLoading(id, true);

  return operationId;
};

const finalizeKnowledgeBaseUpdateLoading = (
  get: () => KnowledgeBaseStore,
  id: string,
  scopeGeneration: number,
  operationId: symbol,
): void => {
  const operations = knowledgeBaseUpdateLoadingOperations.get(id);
  if (
    !operations ||
    operations.scopeGeneration !== scopeGeneration ||
    !operations.operationIds.delete(operationId)
  )
    return;

  if (operations.operationIds.size > 0) return;

  knowledgeBaseUpdateLoadingOperations.delete(id);
  if (get().scopeGeneration !== scopeGeneration) return;

  get().internal_toggleKnowledgeBaseLoading(id, operations.wasLoading);
};

export interface KnowledgeBaseCrudAction {
  createNewKnowledgeBase: (params: CreateKnowledgeBaseParams) => Promise<string>;
  internal_toggleKnowledgeBaseLoading: (id: string, loading: boolean) => void;
  refreshKnowledgeBaseList: (checkpoint?: KnowledgeBaseMutationCheckpoint) => Promise<void>;

  removeKnowledgeBase: (id: string) => Promise<void>;
  updateKnowledgeBase: (id: string, value: CreateKnowledgeBaseParams) => Promise<void>;

  useFetchKnowledgeBaseItem: (id: string) => SWRResponse<KnowledgeBaseItem | undefined>;
  useFetchKnowledgeBaseList: (params?: { suspense?: boolean }) => SWRResponse<KnowledgeBaseItem[]>;
}

export const createCrudSlice: StateCreator<
  KnowledgeBaseStore,
  [['zustand/devtools', never]],
  [],
  KnowledgeBaseCrudAction
> = (set, get) => ({
  createNewKnowledgeBase: async (params) => {
    const checkpoint = captureKnowledgeBaseMutationCheckpoint(get);
    if (!checkpoint || !isKnowledgeBaseMutationCurrent(get, checkpoint)) return '';

    const id = await knowledgeBaseService.createKnowledgeBase(params);
    if (!isKnowledgeBaseMutationCurrent(get, checkpoint)) return '';

    await get().refreshKnowledgeBaseList(checkpoint);
    if (!isKnowledgeBaseMutationCurrent(get, checkpoint)) return '';

    return id;
  },
  internal_toggleKnowledgeBaseLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) {
          if (state.knowledgeBaseLoadingIds.includes(id)) return state;

          return { knowledgeBaseLoadingIds: [...state.knowledgeBaseLoadingIds, id] };
        }

        return { knowledgeBaseLoadingIds: state.knowledgeBaseLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleKnowledgeBaseLoading',
    );
  },
  refreshKnowledgeBaseList: async (requestedCheckpoint) => {
    const checkpoint =
      requestedCheckpoint ?? captureKnowledgeBaseMutationCheckpoint(get);
    if (!checkpoint || !isKnowledgeBaseMutationCurrent(get, checkpoint)) return;

    await mutateAccountSWR([
      FETCH_KNOWLEDGE_BASE_LIST_KEY,
      checkpoint.accountMutationSnapshot.scope,
    ]);
  },
  removeKnowledgeBase: async (id) => {
    const checkpoint = captureKnowledgeBaseMutationCheckpoint(get);
    if (!checkpoint || !id || !isKnowledgeBaseMutationCurrent(get, checkpoint)) return;

    await knowledgeBaseService.deleteKnowledgeBase(id);
    if (!isKnowledgeBaseMutationCurrent(get, checkpoint)) return;

    await get().refreshKnowledgeBaseList(checkpoint);
    if (!isKnowledgeBaseMutationCurrent(get, checkpoint)) return;
  },
  updateKnowledgeBase: async (id, value) => {
    const checkpoint = captureKnowledgeBaseMutationCheckpoint(get);
    if (!checkpoint || !id || !isKnowledgeBaseMutationCurrent(get, checkpoint)) return;

    const loadingOperationId = beginKnowledgeBaseUpdateLoading(
      get,
      id,
      checkpoint.scopeGeneration,
    );

    try {
      await knowledgeBaseService.updateKnowledgeBaseList(id, value);
      if (!isKnowledgeBaseMutationCurrent(get, checkpoint)) return;

      await get().refreshKnowledgeBaseList(checkpoint);
      if (!isKnowledgeBaseMutationCurrent(get, checkpoint)) return;
    } finally {
      finalizeKnowledgeBaseUpdateLoading(
        get,
        id,
        checkpoint.scopeGeneration,
        loadingOperationId,
      );
    }
  },

  useFetchKnowledgeBaseItem: (id) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<KnowledgeBaseItem | undefined>(
      requestedScope ? [FETCH_KNOWLEDGE_BASE_ITEM_KEY, requestedScope, id] : null,
      () => knowledgeBaseService.getKnowledgeBaseById(id),
      {
        onSuccess: (item) => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;
          if (!item) return;

          set({
            activeKnowledgeBaseId: id,
            activeKnowledgeBaseItems: {
              ...get().activeKnowledgeBaseItems,
              [id]: item,
            },
          });
        },
      },
    );
  },

  useFetchKnowledgeBaseList: (params = {}) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<KnowledgeBaseItem[]>(
      requestedScope ? [FETCH_KNOWLEDGE_BASE_LIST_KEY, requestedScope] : null,
      () => knowledgeBaseService.getKnowledgeBaseList(),
      {
        fallbackData: [],
        onSuccess: () => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

          if (!get().initKnowledgeBaseList)
            set({ initKnowledgeBaseList: true }, false, 'useFetchKnowledgeBaseList/init');
        },
        suspense: params.suspense,
      },
    );
  },
});
