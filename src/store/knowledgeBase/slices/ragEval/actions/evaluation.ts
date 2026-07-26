import { CreateNewEvalEvaluation, RAGEvalDataSetItem } from '@lobechat/types';
import { SWRResponse, mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { ragEvalService } from '@/services/ragEval';
import { KnowledgeBaseStore } from '@/store/knowledgeBase/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const FETCH_EVALUATION_LIST_KEY = 'FETCH_EVALUATION_LIST_KEY';

export interface RAGEvalEvaluationAction {
  checkEvaluationStatus: (id: number) => Promise<void>;

  createNewEvaluation: (params: CreateNewEvalEvaluation) => Promise<void>;
  refreshEvaluationList: () => Promise<void>;

  removeEvaluation: (id: number) => Promise<void>;
  runEvaluation: (id: number) => Promise<void>;

  useFetchEvaluationList: (knowledgeBaseId: string) => SWRResponse<RAGEvalDataSetItem[]>;
}

export const createRagEvalEvaluationSlice: StateCreator<
  KnowledgeBaseStore,
  [['zustand/devtools', never]],
  [],
  RAGEvalEvaluationAction
> = (set, get) => ({
  checkEvaluationStatus: async (id) => {
    await ragEvalService.checkEvaluationStatus(id);
  },

  createNewEvaluation: async (params) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    await ragEvalService.createEvaluation(params);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshEvaluationList();
  },
  refreshEvaluationList: async () => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    if (!requestedScope) return;

    await mutate(
      (key) =>
        Array.isArray(key) && key[0] === FETCH_EVALUATION_LIST_KEY && key[1] === requestedScope,
    );
  },

  removeEvaluation: async (id) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    await ragEvalService.removeEvaluation(id);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    // await get().refreshEvaluationList();
  },

  runEvaluation: async (id) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    await ragEvalService.startEvaluationTask(id);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;
  },

  useFetchEvaluationList: (knowledgeBaseId) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<RAGEvalDataSetItem[]>(
      requestedScope ? [FETCH_EVALUATION_LIST_KEY, requestedScope, knowledgeBaseId] : null,
      () => ragEvalService.getEvaluationList(knowledgeBaseId),
      {
        fallbackData: [],
        onSuccess: () => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

          if (!get().initDatasetList)
            set({ initDatasetList: true }, false, 'useFetchDatasets/init');
        },
      },
    );
  },
});
