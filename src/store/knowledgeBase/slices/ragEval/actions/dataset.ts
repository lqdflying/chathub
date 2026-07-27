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
import { KnowledgeBaseStore } from '@/store/knowledgeBase/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const FETCH_DATASET_LIST_KEY = 'FETCH_DATASET_LIST';
const FETCH_DATASET_RECORD_KEY = 'FETCH_DATASET_RECORD_KEY';

export interface RAGEvalDatasetAction {
  createNewDataset: (params: CreateNewEvalDatasets) => Promise<void>;

  importDataset: (file: File, datasetId: number) => Promise<void>;
  refreshDatasetList: () => Promise<void>;
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
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    await ragEvalService.createDataset(params);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshDatasetList();
  },

  importDataset: async (file, datasetId) => {
    if (!datasetId) return;
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;
    const isOperationCurrent = () =>
      authSelectors.currentUserScope(useUserStore.getState()) === requestedScope &&
      get().scopeGeneration === requestedGeneration;

    const fileType = file.name.split('.').pop();

    if (fileType === 'jsonl') {
      // jsonl 文件 需要拆分成单个条，然后逐一校验格式
      const jsonl = await file.text();
      if (!isOperationCurrent()) return;

      const { default: JSONL } = await import('jsonl-parse-stringify');
      if (!isOperationCurrent()) return;

      try {
        const items = JSONL.parse(jsonl);

        // check if the items are valid
        insertEvalDatasetRecordSchema.array().parse(items);

        // if valid, send to backend
        await ragEvalService.importDatasetRecords(datasetId, file);
        if (!isOperationCurrent()) return;
      } catch (e) {
        if (!isOperationCurrent()) return;

        notification.error({ description: (e as Error).message, message: '文件格式错误' });
      }
    }

    if (!isOperationCurrent()) return;

    await get().refreshDatasetList();
  },
  refreshDatasetList: async () => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    if (!requestedScope) return;

    await mutateAccountSWRByPredicate(
      requestedScope,
      (key) => key[0] === FETCH_DATASET_LIST_KEY,
    );
  },

  removeDataset: async (id) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    await ragEvalService.removeDataset(id);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshDatasetList();
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
