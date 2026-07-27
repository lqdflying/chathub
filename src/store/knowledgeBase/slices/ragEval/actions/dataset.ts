import {
  CreateNewEvalDatasets,
  EvalDatasetRecord,
  RAGEvalDataSetItem,
  insertEvalDatasetRecordSchema,
} from '@lobechat/types';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { notification } from '@/components/AntdStaticMethods';
import { mutateAccountSWRByPredicate, useClientDataSWR } from '@/libs/swr';
import { ragEvalService } from '@/services/ragEval';
import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { KnowledgeBaseStore } from '@/store/knowledgeBase/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const FETCH_DATASET_LIST_KEY = 'FETCH_DATASET_LIST';
const FETCH_DATASET_RECORD_KEY = 'FETCH_DATASET_RECORD_KEY';

export interface RAGEvalDatasetAction {
  createNewDataset: (params: CreateNewEvalDatasets) => Promise<void>;

  importDataset: (file: File, datasetId: number) => Promise<void>;
  refreshDatasetList: (knowledgeBaseId?: string) => Promise<void>;
  removeDataset: (id: number) => Promise<void>;
  useFetchDatasetRecords: (datasetId: number | null) => SWRResponse<EvalDatasetRecord[]>;
  useFetchDatasets: (knowledgeBaseId: string) => SWRResponse<RAGEvalDataSetItem[]>;
}

export const createRagEvalDatasetSlice: StateCreator<
  KnowledgeBaseStore,
  [['zustand/devtools', never]],
  [],
  RAGEvalDatasetAction
> = (set, get) => ({
  createNewDataset: async (params) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    const requestedKnowledgeBaseId = params.knowledgeBaseId;
    if (!accountMutationSnapshot || !requestedKnowledgeBaseId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().scopeGeneration === requestedGeneration;

    await ragEvalService.createDataset(params);
    if (!isCurrentRequest()) return;

    await get().refreshDatasetList(requestedKnowledgeBaseId);
    if (!isCurrentRequest()) return;
  },

  importDataset: async (file, datasetId) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!accountMutationSnapshot || !datasetId) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().scopeGeneration === requestedGeneration;

    const fileType = file.name.split('.').pop();

    if (fileType === 'jsonl') {
      // jsonl 文件 需要拆分成单个条，然后逐一校验格式
      const jsonl = await file.text();
      if (!isCurrentRequest()) return;

      const { default: JSONL } = await import('jsonl-parse-stringify');
      if (!isCurrentRequest()) return;

      try {
        const items = JSONL.parse(jsonl);

        // check if the items are valid
        insertEvalDatasetRecordSchema.array().parse(items);

        // if valid, send to backend
        await ragEvalService.importDatasetRecords(datasetId, file, {
          isContinuationCurrent: isCurrentRequest,
        });
        if (!isCurrentRequest()) return;
      } catch (e) {
        if (!isCurrentRequest()) return;

        notification.error({ description: (e as Error).message, message: '文件格式错误' });
      }
    }

    if (!isCurrentRequest()) return;

    await mutateAccountSWRByPredicate(
      accountMutationSnapshot.scope,
      (key) => key[0] === FETCH_DATASET_RECORD_KEY && key[2] === datasetId,
    );
    if (!isCurrentRequest()) return;
  },
  refreshDatasetList: async (knowledgeBaseId) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    if (!requestedScope) return;

    await mutateAccountSWRByPredicate(
      requestedScope,
      (key) =>
        key[0] === FETCH_DATASET_LIST_KEY &&
        (knowledgeBaseId === undefined || key[2] === knowledgeBaseId),
    );
  },

  removeDataset: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!accountMutationSnapshot || !id) return;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().scopeGeneration === requestedGeneration;

    await ragEvalService.removeDataset(id);
    if (!isCurrentRequest()) return;
  },
  useFetchDatasetRecords: (datasetId) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<EvalDatasetRecord[]>(
      datasetId && requestedScope ? [FETCH_DATASET_RECORD_KEY, requestedScope, datasetId] : null,
      () => ragEvalService.getDatasetRecords(datasetId!),
    );
  },
  useFetchDatasets: (knowledgeBaseId) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<RAGEvalDataSetItem[]>(
      requestedScope ? [FETCH_DATASET_LIST_KEY, requestedScope, knowledgeBaseId] : null,
      () => ragEvalService.getDatasets(knowledgeBaseId),
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
