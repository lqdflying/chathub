import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import {
  NewGeneration,
  NewGenerationBatch,
  asyncTasks,
  generationBatches,
  generationTopics,
  generations,
} from '@/database/schemas';
import {
  createImageDiagnosticId,
  describeImageDebugError,
  fingerprintImageDebugValue,
  isImageDebugEnabled,
  logImageDebugSafe,
  logImageDebugVerbose,
  runWithImageDebugContext,
} from '@/libs/logger/imageDebug';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { keyVaults, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createAsyncCaller } from '@/server/routers/async/caller';
import { FileService } from '@/server/services/file';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';
import { generateUniqueSeeds } from '@/utils/number';

import {
  type CreateImageServicePayload,
  createImageInputSchema,
  validateNoUrlsInConfig,
} from './image/schema';

export type { CreateImageServicePayload } from './image/schema';

const IMAGE_TRIGGER_ERROR_MESSAGE =
  'trigger image generation async task error. Please make sure INTERNAL_APP_URL or APP_URL is reachable from the server.';

const normalizeImageReference = async (reference: string, fileService: FileService) => {
  if (reference.startsWith('data:')) {
    return {
      databaseReference: reference,
      dispatchReference: reference,
    };
  }

  const databaseReference = fileService.getKeyFromFullUrl(reference);
  const dispatchReference = await fileService.getFullFileUrl(databaseReference);

  return {
    databaseReference,
    dispatchReference,
  };
};

const createSubmissionDebugFields = ({
  generationTopicId,
  imageNum,
  model,
  params,
  provider,
}: CreateImageServicePayload) => ({
  cfgConfigured: params.cfg !== undefined,
  height: params.height,
  imageCount: imageNum,
  imageReferenceCount: Array.isArray(params.imageUrls) ? params.imageUrls.length : 0,
  modelHash: fingerprintImageDebugValue('image-model', model),
  outcome: 'accepted',
  phase: 'submission',
  provider,
  seedConfigured: 'seed' in params,
  steps: params.steps,
  topicHash: fingerprintImageDebugValue('generation-topic-id', generationTopicId),
  width: params.width,
});

const createTaskDebugFields = ({
  asyncTaskId,
  batchId,
  generationId,
}: {
  asyncTaskId: string;
  batchId?: string;
  generationId: string;
}) => ({
  batchHash: batchId ? fingerprintImageDebugValue('generation-batch-id', batchId) : undefined,
  generationHash: fingerprintImageDebugValue('generation-id', generationId),
  taskHash: fingerprintImageDebugValue('async-task-id', asyncTaskId),
});

const markPendingTaskTriggerError = async ({
  asyncTaskId,
  asyncTaskModel,
  batchId,
  error,
  generationId,
}: {
  asyncTaskId: string;
  asyncTaskModel: AsyncTaskModel;
  batchId?: string;
  error: unknown;
  generationId: string;
}) => {
  const taskFields = createTaskDebugFields({ asyncTaskId, batchId, generationId });
  logImageDebugSafe('dispatch_settled', {
    ...taskFields,
    ...describeImageDebugError(error),
    failurePhase: 'dispatch',
    outcome: 'failed',
    phase: 'dispatch',
  });

  try {
    const updated = await asyncTaskModel.updatePendingToError(asyncTaskId, {
      error: new AsyncTaskError(AsyncTaskErrorType.TaskTriggerError, IMAGE_TRIGGER_ERROR_MESSAGE),
      status: AsyncTaskStatus.Error,
    });

    logImageDebugSafe('task_status_settled', {
      ...taskFields,
      outcome: updated ? 'updated' : 'skipped',
      phase: 'trigger_failure',
      taskStatus: updated ? AsyncTaskStatus.Error : 'not_pending',
    });
  } catch (statusError) {
    logImageDebugSafe('task_status_settled', {
      ...taskFields,
      ...describeImageDebugError(statusError),
      failurePhase: 'status_update',
      outcome: 'failed',
      phase: 'trigger_failure',
    });
  }
};

const imageProcedure = authedProcedure
  .use(keyVaults)
  .use(serverDatabase)
  .use(async (opts) => {
    const { ctx } = opts;

    return opts.next({
      ctx: {
        asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
        fileService: new FileService(ctx.serverDB, ctx.userId),
      },
    });
  });

export const imageRouter = router({
  createImage: imageProcedure.input(createImageInputSchema).mutation(async ({ input, ctx }) => {
    const execute = async () => {
      const { userId, serverDB, asyncTaskModel, fileService } = ctx;
      const { generationTopicId, provider, model, imageNum, params } = input;

      logImageDebugSafe('submission_accepted', createSubmissionDebugFields(input));
      logImageDebugVerbose('submission_accepted', {
        model,
        params,
        provider,
      });

      // 规范化参考图地址，统一存储 S3 key（避免把会过期的预签名 URL 存进数据库）
      let configForDatabase = { ...params };
      let paramsForDispatch = { ...params };
      // 1) 处理多图 imageUrls
      if (Array.isArray(params.imageUrls) && params.imageUrls.length > 0) {
        try {
          const normalizedReferences = await Promise.all(
            params.imageUrls.map((reference) => normalizeImageReference(reference, fileService)),
          );

          configForDatabase = {
            ...configForDatabase,
            imageUrls: normalizedReferences.map(({ databaseReference }) => databaseReference),
          };
          paramsForDispatch = {
            ...paramsForDispatch,
            imageUrls: normalizedReferences.map(({ dispatchReference }) => dispatchReference),
          };
        } catch (error) {
          logImageDebugSafe('config_warning', {
            ...describeImageDebugError(error),
            failurePhase: 'reference_image_normalization',
            outcome: 'warning',
            phase: 'submission',
          });
        }
      }

      // 2) 处理单图 imageUrl
      if (typeof params.imageUrl === 'string' && params.imageUrl) {
        try {
          const { databaseReference, dispatchReference } = await normalizeImageReference(
            params.imageUrl,
            fileService,
          );
          configForDatabase = { ...configForDatabase, imageUrl: databaseReference };
          paramsForDispatch = { ...paramsForDispatch, imageUrl: dispatchReference };
        } catch (error) {
          logImageDebugSafe('config_warning', {
            ...describeImageDebugError(error),
            failurePhase: 'reference_image_normalization',
            outcome: 'warning',
            phase: 'submission',
          });
          // 转换失败则保留原始值
        }
      }

      // 防御性检测：确保没有完整URL进入数据库
      validateNoUrlsInConfig(configForDatabase, 'configForDatabase');

      // 步骤 1: 在事务中原子性地创建所有数据库记录
      const { batch: createdBatch, generationsWithTasks } = await serverDB.transaction(
        async (tx) => {
          const [ownedTopic] = await tx
            .select({ id: generationTopics.id })
            .from(generationTopics)
            .where(
              and(eq(generationTopics.id, generationTopicId), eq(generationTopics.userId, userId)),
            )
            .limit(1);

          if (!ownedTopic) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Generation topic does not belong to the current user',
            });
          }

          // 1. 创建 generationBatch
          const newBatch: NewGenerationBatch = {
            config: configForDatabase,
            generationTopicId,
            height: params.height,
            model,
            prompt: params.prompt,
            provider,
            userId,
            width: params.width, // 使用转换后的配置存储到数据库
          };
          const [batch] = await tx.insert(generationBatches).values(newBatch).returning();

          // 2. 创建 4 个 generation（一期固定生成 4 张）
          const seeds =
            'seed' in params
              ? generateUniqueSeeds(imageNum)
              : Array.from({ length: imageNum }, () => null);
          const newGenerations: NewGeneration[] = Array.from({ length: imageNum }, (_, index) => {
            return {
              generationBatchId: batch.id,
              seed: seeds[index],
              userId,
            };
          });

          const createdGenerations = await tx
            .insert(generations)
            .values(newGenerations)
            .returning();

          // 3. 并发为每个 generation 创建 asyncTask（在事务中）
          const generationsWithTasks = await Promise.all(
            createdGenerations.map(async (generation) => {
              // 在事务中直接创建 asyncTask
              const [createdAsyncTask] = await tx
                .insert(asyncTasks)
                .values({
                  status: AsyncTaskStatus.Pending,
                  type: AsyncTaskType.ImageGeneration,
                  userId,
                })
                .returning();

              const asyncTaskId = createdAsyncTask.id;

              // 更新 generation 的 asyncTaskId
              await tx
                .update(generations)
                .set({ asyncTaskId })
                .where(and(eq(generations.id, generation.id), eq(generations.userId, userId)));

              return { asyncTaskId, generation };
            }),
          );

          return {
            batch,
            generationsWithTasks,
          };
        },
      );

      logImageDebugSafe('batch_persisted', {
        batchHash: fingerprintImageDebugValue('generation-batch-id', createdBatch.id),
        generationCount: generationsWithTasks.length,
        outcome: 'completed',
        phase: 'persistence',
        provider,
        taskCount: generationsWithTasks.length,
      });

      // 步骤 2: 直接执行所有生图任务（去掉 after 包装）
      try {
        // 使用统一的 caller 工厂创建 caller
        const asyncCaller = await createAsyncCaller({
          jwtPayload: ctx.jwtPayload,
          userId: ctx.userId,
        });

        // 启动所有图像生成任务（不等待完成，真正的后台任务）
        generationsWithTasks.forEach(({ generation, asyncTaskId }) => {
          const taskFields = createTaskDebugFields({
            asyncTaskId,
            batchId: createdBatch.id,
            generationId: generation.id,
          });

          logImageDebugSafe('dispatch_started', {
            ...taskFields,
            modelHash: fingerprintImageDebugValue('image-model', model),
            phase: 'dispatch',
            provider,
          });

          asyncCaller.image
            .createImage({
              generationId: generation.id,
              model,
              params: paramsForDispatch,
              provider,
              taskId: asyncTaskId,
            })
            .then((result) => {
              logImageDebugSafe('dispatch_settled', {
                ...taskFields,
                outcome: result?.success === false ? 'failed' : 'completed',
                phase: 'dispatch',
              });
            })
            .catch((error) =>
              markPendingTaskTriggerError({
                asyncTaskId,
                asyncTaskModel,
                batchId: createdBatch.id,
                error,
                generationId: generation.id,
              }),
            );
        });
      } catch (error) {
        logImageDebugSafe('dispatch_settled', {
          ...describeImageDebugError(error),
          batchHash: fingerprintImageDebugValue('generation-batch-id', createdBatch.id),
          failurePhase: 'caller_initialization',
          generationCount: generationsWithTasks.length,
          outcome: 'failed',
          phase: 'dispatch',
        });

        await Promise.allSettled(
          generationsWithTasks.map(({ asyncTaskId, generation }) =>
            markPendingTaskTriggerError({
              asyncTaskId,
              asyncTaskModel,
              batchId: createdBatch.id,
              error,
              generationId: generation.id,
            }),
          ),
        );
      }

      const createdGenerations = generationsWithTasks.map((item) => item.generation);

      return {
        data: {
          batch: createdBatch,
          generations: createdGenerations,
        },
        success: true,
      };
    };

    if (!isImageDebugEnabled()) {
      return execute();
    }

    return runWithImageDebugContext(
      {
        diagnosticId: createImageDiagnosticId(),
        operation: 'image.createImage',
        runtime: 'lambda',
        transport: 'trpc',
      },
      execute,
    );
  }),
});

export type ImageRouter = typeof imageRouter;
