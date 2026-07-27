import { isEqual } from 'lodash-es';
import { useRef } from 'react';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand';

import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { GetGenerationStatusResult } from '@/server/routers/lambda/generation';
import { generationService } from '@/services/generation';
import { generationBatchService } from '@/services/generationBatch';
import type { AccountMutationSnapshot } from '@/store/accountMutation';
import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { GenerationBatch } from '@/types/generation';
import { setNamespace } from '@/utils/storeDebug';

import { ImageStore } from '../../store';
import { generationTopicSelectors } from '../generationTopic/selectors';
import { GenerationBatchDispatch, generationBatchReducer } from './reducer';

const n = setNamespace('generationBatch');

// ====== SWR key ====== //
const SWR_USE_FETCH_GENERATION_BATCHES = 'SWR_USE_FETCH_GENERATION_BATCHES';
const SWR_USE_CHECK_GENERATION_STATUS = 'SWR_USE_CHECK_GENERATION_STATUS';

interface GenerationBatchMutationContext {
  account: AccountMutationSnapshot;
  scopeGeneration: number;
}

interface GenerationIdentity {
  batchId: string;
  generationId: string;
  topicId: string;
}

const latestGenerationBatchOperations = new Map<string, symbol>();

const captureGenerationBatchMutationContext = (
  state: ImageStore,
): GenerationBatchMutationContext | undefined => {
  const account = captureAccountMutationSnapshot(useUserStore.getState());
  if (!account) return;

  return { account, scopeGeneration: state.scopeGeneration };
};

const isGenerationBatchMutationCurrent = (
  state: ImageStore,
  context: GenerationBatchMutationContext,
): boolean =>
  isAccountMutationCurrent(useUserStore.getState(), context.account) &&
  state.scopeGeneration === context.scopeGeneration;

const findGenerationIdentity = (
  state: ImageStore,
  generationId: string,
): GenerationIdentity | undefined => {
  for (const [topicId, batches] of Object.entries(state.generationBatchesMap)) {
    const batch = batches.find((item) =>
      item.generations.some((generation) => generation.id === generationId),
    );
    if (batch) return { batchId: batch.id, generationId, topicId };
  }
};

const getGenerationBatchOperationKey = (
  context: GenerationBatchMutationContext,
  resourceType: 'batch' | 'generation',
  resourceId: string,
) =>
  [
    context.account.scope,
    context.account.ownershipInvalidationGeneration,
    context.scopeGeneration,
    resourceType,
    resourceId,
  ].join(':');

const beginGenerationBatchOperation = (
  context: GenerationBatchMutationContext,
  resourceType: 'batch' | 'generation',
  resourceId: string,
) => {
  const operationKey = getGenerationBatchOperationKey(context, resourceType, resourceId);
  const operationId = Symbol(operationKey);
  latestGenerationBatchOperations.set(operationKey, operationId);

  return { operationId, operationKey };
};

const isGenerationBatchOperationCurrent = (
  state: ImageStore,
  context: GenerationBatchMutationContext,
  operation: ReturnType<typeof beginGenerationBatchOperation>,
): boolean =>
  isGenerationBatchMutationCurrent(state, context) &&
  latestGenerationBatchOperations.get(operation.operationKey) === operation.operationId;

const finishGenerationBatchOperation = (
  operation: ReturnType<typeof beginGenerationBatchOperation>,
) => {
  if (latestGenerationBatchOperations.get(operation.operationKey) === operation.operationId) {
    latestGenerationBatchOperations.delete(operation.operationKey);
  }
};

// ====== action interface ====== //

export interface GenerationBatchAction {
  setTopicBatchLoaded: (topicId: string) => void;
  internal_dispatchGenerationBatch: (
    topicId: string,
    payload: GenerationBatchDispatch,
    action?: string,
  ) => void;
  removeGeneration: (generationId: string) => Promise<void>;
  internal_deleteGeneration: (
    generationId: string,
    mutationContext?: GenerationBatchMutationContext,
    generationIdentity?: GenerationIdentity,
  ) => Promise<boolean>;
  removeGenerationBatch: (batchId: string, topicId: string) => Promise<void>;
  internal_deleteGenerationBatch: (
    batchId: string,
    topicId: string,
    mutationContext?: GenerationBatchMutationContext,
  ) => Promise<boolean>;
  refreshGenerationBatches: (
    topicId?: string,
    mutationContext?: GenerationBatchMutationContext,
  ) => Promise<void>;
  useCheckGenerationStatus: (
    generationId: string,
    asyncTaskId: string,
    topicId: string,
    enable?: boolean,
  ) => SWRResponse<GetGenerationStatusResult>;
  useFetchGenerationBatches: (topicId?: string | null) => SWRResponse<GenerationBatch[]>;
}

// ====== action implementation ====== //

export const createGenerationBatchSlice: StateCreator<
  ImageStore,
  [['zustand/devtools', never]],
  [],
  GenerationBatchAction
> = (set, get) => ({
  setTopicBatchLoaded: (topicId: string) => {
    const nextMap = {
      ...get().generationBatchesMap,
      [topicId]: [],
    };

    // no need to update map if the map is the same
    if (isEqual(nextMap, get().generationBatchesMap)) return;

    set(
      {
        generationBatchesMap: nextMap,
      },
      false,
      n('setTopicBatchLoaded'),
    );
  },

  removeGeneration: async (generationId: string) => {
    const mutationContext = captureGenerationBatchMutationContext(get());
    if (!mutationContext) return;

    const generationIdentity = findGenerationIdentity(get(), generationId);
    const wasDeleted = await get().internal_deleteGeneration(
      generationId,
      mutationContext,
      generationIdentity,
    );
    if (
      !generationIdentity ||
      !wasDeleted ||
      !isGenerationBatchMutationCurrent(get(), mutationContext)
    )
      return;

    const targetBatch = get().generationBatchesMap[generationIdentity.topicId]?.find(
      (batch) => batch.id === generationIdentity.batchId,
    );
    if (!targetBatch || targetBatch.generations.length > 0) return;

    await get().internal_deleteGenerationBatch(
      generationIdentity.batchId,
      generationIdentity.topicId,
      mutationContext,
    );
  },

  internal_deleteGeneration: async (generationId, originatingContext, originatingIdentity) => {
    const mutationContext =
      originatingContext ?? captureGenerationBatchMutationContext(get());
    if (!mutationContext || !isGenerationBatchMutationCurrent(get(), mutationContext)) return false;

    const generationIdentity = originatingIdentity ?? findGenerationIdentity(get(), generationId);
    if (!generationIdentity || generationIdentity.generationId !== generationId) return false;

    const operation = beginGenerationBatchOperation(mutationContext, 'generation', generationId);
    const isCurrentRequest = () =>
      isGenerationBatchOperationCurrent(get(), mutationContext, operation);

    try {
      // 1. 立即更新前端状态（乐观更新）
      get().internal_dispatchGenerationBatch(
        generationIdentity.topicId,
        {
          type: 'deleteGenerationInBatch',
          batchId: generationIdentity.batchId,
          generationId,
        },
        'internal_deleteGeneration',
      );
      if (!isCurrentRequest()) return false;

      // 2. 调用后端服务删除generation
      await generationService.deleteGeneration(generationId);
      if (!isCurrentRequest()) return false;

      // 3. 刷新原始 topic 的数据确保一致性
      await get().refreshGenerationBatches(generationIdentity.topicId, mutationContext);
      return isCurrentRequest();
    } finally {
      finishGenerationBatchOperation(operation);
    }
  },

  removeGenerationBatch: async (batchId: string, topicId: string) => {
    const mutationContext = captureGenerationBatchMutationContext(get());
    if (!mutationContext) return;

    await get().internal_deleteGenerationBatch(batchId, topicId, mutationContext);
  },

  internal_deleteGenerationBatch: async (batchId, topicId, originatingContext) => {
    const mutationContext =
      originatingContext ?? captureGenerationBatchMutationContext(get());
    if (!mutationContext || !isGenerationBatchMutationCurrent(get(), mutationContext)) return false;

    const operation = beginGenerationBatchOperation(mutationContext, 'batch', batchId);
    const isCurrentRequest = () =>
      isGenerationBatchOperationCurrent(get(), mutationContext, operation);

    try {
      // 1. 立即更新前端状态（乐观更新）
      get().internal_dispatchGenerationBatch(
        topicId,
        { type: 'deleteBatch', id: batchId },
        'internal_deleteGenerationBatch',
      );
      if (!isCurrentRequest()) return false;

      // 2. 调用后端服务
      await generationBatchService.deleteGenerationBatch(batchId);
      if (!isCurrentRequest()) return false;

      // 3. 刷新原始 topic 的数据确保一致性
      await get().refreshGenerationBatches(topicId, mutationContext);
      return isCurrentRequest();
    } finally {
      finishGenerationBatchOperation(operation);
    }
  },

  internal_dispatchGenerationBatch: (topicId, payload, action) => {
    const currentBatches = get().generationBatchesMap[topicId] || [];
    const nextBatches = generationBatchReducer(currentBatches, payload);

    const nextMap = {
      ...get().generationBatchesMap,
      [topicId]: nextBatches,
    };

    // no need to update map if the map is the same
    if (isEqual(nextMap, get().generationBatchesMap)) return;

    set(
      {
        generationBatchesMap: nextMap,
      },
      false,
      action ?? n(`dispatchGenerationBatch/${payload.type}`),
    );
  },

  refreshGenerationBatches: async (topicId, originatingContext) => {
    const mutationContext =
      originatingContext ?? captureGenerationBatchMutationContext(get());
    if (!mutationContext || !isGenerationBatchMutationCurrent(get(), mutationContext)) return;

    const requestedTopicId = topicId ?? get().activeGenerationTopicId;
    if (!requestedTopicId) return;

    await mutateAccountSWR([
      SWR_USE_FETCH_GENERATION_BATCHES,
      mutationContext.account.scope,
      requestedTopicId,
    ]);
  },

  useFetchGenerationBatches: (topicId) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<GenerationBatch[]>(
      topicId && requestedScope
        ? [SWR_USE_FETCH_GENERATION_BATCHES, requestedScope, topicId]
        : null,
      async (cacheKey: [string, string, string]) => {
        return generationBatchService.getGenerationBatches(cacheKey[2]);
      },
      {
        onSuccess: (data) => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

          const nextMap = {
            ...get().generationBatchesMap,
            [topicId!]: data,
          };

          // no need to update map if the map is the same
          if (isEqual(nextMap, get().generationBatchesMap)) return;

          set(
            {
              generationBatchesMap: nextMap,
            },
            false,
            n('useFetchGenerationBatches(success)', { topicId }),
          );
        },
      },
    );
  },

  useCheckGenerationStatus: (generationId, asyncTaskId, topicId, enable = true) => {
    const requestCountRef = useRef(0);
    const isErrorRef = useRef(false);
    const requestedScope = useUserStore(authSelectors.currentUserScope);
    const mutationContext = captureGenerationBatchMutationContext(get());

    return useClientDataSWR<GetGenerationStatusResult>(
      enable && generationId && !generationId.startsWith('temp-') && asyncTaskId && requestedScope
        ? [SWR_USE_CHECK_GENERATION_STATUS, requestedScope, generationId, asyncTaskId]
        : null,
      async (cacheKey: [string, string, string, string]) => {
        const generationId = cacheKey[2];
        const asyncTaskId = cacheKey[3];

        // 增加请求计数
        requestCountRef.current += 1;
        return generationService.getGenerationStatus(generationId, asyncTaskId);
      },
      {
        refreshWhenHidden: false,
        refreshInterval: (data: GetGenerationStatusResult | undefined) => {
          // 如果状态是 success 或 error，停止轮询
          if (data?.status === AsyncTaskStatus.Success || data?.status === AsyncTaskStatus.Error) {
            return 0; // 停止轮询
          }

          // 根据请求次数动态调整间隔：使用指数退避算法
          // 基础间隔 1 秒，最大间隔 30 秒
          const baseInterval = 1000;
          const maxInterval = 30_000;
          const currentCount = requestCountRef.current;

          // 指数退避：每 5 次请求后间隔翻倍
          const backoffMultiplier = Math.floor(currentCount / 5);
          let dynamicInterval = Math.min(
            baseInterval * Math.pow(2, backoffMultiplier),
            maxInterval,
          );

          // 如果之前有错误，使用更长的间隔（乘以 2）
          if (isErrorRef.current) {
            dynamicInterval = Math.min(dynamicInterval * 2, maxInterval);
          }

          return dynamicInterval;
        },
        onError: (error) => {
          // 发生错误时设置错误状态
          isErrorRef.current = true;
          console.error('Generation status check error:', error);
        },
        onSuccess: async (data: GetGenerationStatusResult) => {
          if (!data) return;
          if (
            !mutationContext ||
            !isGenerationBatchMutationCurrent(get(), mutationContext) ||
            mutationContext.account.scope !== requestedScope
          )
            return;

          // 成功时重置错误状态
          isErrorRef.current = false;

          // 找到对应的 batch，generation 数据库记录包含 generationBatchId
          const currentBatches = get().generationBatchesMap[topicId] || [];
          const targetBatch = currentBatches.find((batch) =>
            batch.generations.some(
              (generation) =>
                generation.id === generationId && generation.asyncTaskId === asyncTaskId,
            ),
          );
          const isGenerationStatusCurrent = () =>
            isGenerationBatchMutationCurrent(get(), mutationContext) &&
            get().generationBatchesMap[topicId]?.some(
              (batch) =>
                batch.id === targetBatch?.id &&
                batch.generations.some(
                  (generation) =>
                    generation.id === generationId && generation.asyncTaskId === asyncTaskId,
                ),
            );

          // 如果状态为成功或错误，都要更新对应的 generation
          if (
            (data.status === AsyncTaskStatus.Success || data.status === AsyncTaskStatus.Error) &&
            targetBatch
          ) {
            // 重置请求计数器，因为任务已完成
            requestCountRef.current = 0;

            if (data.generation) {
              // 更新 generation 数据
              get().internal_dispatchGenerationBatch(
                topicId,
                {
                  type: 'updateGenerationInBatch',
                  batchId: targetBatch.id,
                  generationId,
                  value: data.generation,
                },
                n(
                  `useCheckGenerationStatus/${data.status === AsyncTaskStatus.Success ? 'success' : 'error'}`,
                ),
              );

              // 如果生成成功且有缩略图，检查当前 topic 是否有 imageUrl
              if (data.status === AsyncTaskStatus.Success && data.generation.asset?.thumbnailUrl) {
                const currentTopic =
                  generationTopicSelectors.getGenerationTopicById(topicId)(get());

                // 如果当前 topic 没有 imageUrl，使用这个 generation 的 thumbnailUrl 更新
                if (currentTopic && !currentTopic.coverUrl) {
                  await get().internal_updateGenerationTopicCover(
                    topicId,
                    data.generation.asset.thumbnailUrl,
                    mutationContext,
                  );
                  if (!isGenerationStatusCurrent()) return;
                }
              }
            }

            // 在成功或失败后都要 refreshGenerationBatches
            if (!isGenerationStatusCurrent()) return;
            await get().refreshGenerationBatches(topicId, mutationContext);
          }
        },
      },
    );
  },
});
