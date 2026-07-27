import { CreateNewEvalEvaluation, RAGEvalDataSetItem } from '@lobechat/types';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { mutateAccountSWRByPredicate, useClientDataSWR } from '@/libs/swr';
import { ragEvalService } from '@/services/ragEval';
import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { KnowledgeBaseStore } from '@/store/knowledgeBase/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const FETCH_EVALUATION_LIST_KEY = 'FETCH_EVALUATION_LIST_KEY';

export interface RAGEvalEvaluationAction {
  checkEvaluationStatus: (id: number) => Promise<void>;

  createNewEvaluation: (params: CreateNewEvalEvaluation) => Promise<void>;
  refreshEvaluationList: (knowledgeBaseId?: string) => Promise<void>;

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
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!accountMutationSnapshot || !id) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().scopeGeneration === requestedGeneration;

    await ragEvalService.checkEvaluationStatus(id);
    if (!isCurrentRequest()) return;
  },

  createNewEvaluation: async (params) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    const requestedKnowledgeBaseId = params.knowledgeBaseId;
    if (!accountMutationSnapshot || !requestedKnowledgeBaseId || !params.datasetId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().scopeGeneration === requestedGeneration;

    await ragEvalService.createEvaluation(params);
    if (!isCurrentRequest()) return;

    await get().refreshEvaluationList(requestedKnowledgeBaseId);
    if (!isCurrentRequest()) return;
  },
  refreshEvaluationList: async (knowledgeBaseId) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    if (!requestedScope) return;

    await mutateAccountSWRByPredicate(
      requestedScope,
      (key) =>
        key[0] === FETCH_EVALUATION_LIST_KEY &&
        (knowledgeBaseId === undefined || key[2] === knowledgeBaseId),
    );
  },

  removeEvaluation: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!accountMutationSnapshot || !id) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().scopeGeneration === requestedGeneration;

    await ragEvalService.removeEvaluation(id);
    if (!isCurrentRequest()) return;

    // await get().refreshEvaluationList();
  },

  runEvaluation: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!accountMutationSnapshot || !id) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().scopeGeneration === requestedGeneration;

    await ragEvalService.startEvaluationTask(id);
    if (!isCurrentRequest()) return;
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
