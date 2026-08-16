import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus, FileSource } from '@lobechat/types';
import { RuntimeImageGenParams } from 'model-bank';
import { z } from 'zod';

import { ASYNC_TASK_TIMEOUT, AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import { GenerationModel } from '@/database/models/generation';
import {
  describeImageDebugError,
  fingerprintImageDebugValue,
  logImageDebugSafe,
  logImageDebugVerbose,
} from '@/libs/logger/imageDebug';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { GenerationService } from '@/server/services/generation';

const FILENAME_MAX_LENGTH = 50;

const createTaskDebugFields = ({
  generationId,
  model,
  provider,
  taskId,
}: {
  generationId: string;
  model: string;
  provider: string;
  taskId: string;
}) => ({
  generationHash: fingerprintImageDebugValue('generation-id', generationId),
  modelHash: fingerprintImageDebugValue('image-model', model),
  provider,
  taskHash: fingerprintImageDebugValue('async-task-id', taskId),
});

const imageProcedure = asyncAuthedProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      generationModel: new GenerationModel(ctx.serverDB, ctx.userId),
      generationService: new GenerationService(ctx.serverDB, ctx.userId),
    },
  });
});

const createImageInputSchema = z.object({
  generationId: z.string(),
  model: z.string(),
  params: z
    .object({
      cfg: z.number().optional(),
      height: z.number().optional(),
      imageUrls: z.array(z.string()).optional(),
      prompt: z.string(),
      seed: z.number().nullable().optional(),
      steps: z.number().optional(),
      width: z.number().optional(),
    })
    .passthrough(),
  provider: z.string(),
  taskId: z.string(),
});

/**
 * Checks if the abort signal has been triggered and throws an error if so
 */
const checkAbortSignal = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw new Error('Operation was aborted');
  }
};

/**
 * Categorizes errors into appropriate AsyncTaskErrorType
 * Returns the original error message if available, otherwise returns the error type as message
 * Client should handle localization based on errorType
 */
const categorizeError = (
  error: any,
  isAborted: boolean,
): { errorMessage: string; errorType: AsyncTaskErrorType } => {
  // Handle Comfy UI errors
  if (error.errorType === AgentRuntimeErrorType.ComfyUIServiceUnavailable) {
    return {
      errorMessage:
        error.error?.message || error.message || AgentRuntimeErrorType.ComfyUIServiceUnavailable,
      errorType: AsyncTaskErrorType.InvalidProviderAPIKey,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ComfyUIBizError) {
    return {
      errorMessage: error.error?.message || error.message || AgentRuntimeErrorType.ComfyUIBizError,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ComfyUIWorkflowError) {
    return {
      errorMessage:
        error.error?.message || error.message || AgentRuntimeErrorType.ComfyUIWorkflowError,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ComfyUIModelError) {
    return {
      errorMessage:
        error.error?.message || error.message || AgentRuntimeErrorType.ComfyUIModelError,
      errorType: AsyncTaskErrorType.ModelNotFound,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ConnectionCheckFailed) {
    return {
      errorMessage: error.message || AgentRuntimeErrorType.ConnectionCheckFailed,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.PermissionDenied) {
    return {
      errorMessage: error.error?.message || error.message || AgentRuntimeErrorType.PermissionDenied,
      errorType: AsyncTaskErrorType.InvalidProviderAPIKey,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ModelNotFound) {
    return {
      errorMessage: error.error?.message || error.message || AgentRuntimeErrorType.ModelNotFound,
      errorType: AsyncTaskErrorType.ModelNotFound,
    };
  }

  // FIXME: 401 的问题应该放到 agentRuntime 中处理会更好
  if (error.errorType === AgentRuntimeErrorType.InvalidProviderAPIKey || error?.status === 401) {
    return {
      errorMessage:
        error.error?.message || error.message || AgentRuntimeErrorType.InvalidProviderAPIKey,
      errorType: AsyncTaskErrorType.InvalidProviderAPIKey,
    };
  }

  if (error instanceof AsyncTaskError) {
    return {
      errorMessage: typeof error.body === 'string' ? error.body : error.body.detail,
      errorType: error.name as AsyncTaskErrorType,
    };
  }

  if (isAborted || error.message?.includes('aborted')) {
    return {
      errorMessage: AsyncTaskErrorType.Timeout,
      errorType: AsyncTaskErrorType.Timeout,
    };
  }

  if (error.message?.includes('timeout') || error.name === 'TimeoutError') {
    return {
      errorMessage: AsyncTaskErrorType.Timeout,
      errorType: AsyncTaskErrorType.Timeout,
    };
  }

  if (error.message?.includes('network') || error.name === 'NetworkError') {
    return {
      errorMessage: error.message || AsyncTaskErrorType.ServerError,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  return {
    errorMessage: error.message || AsyncTaskErrorType.ServerError,
    errorType: AsyncTaskErrorType.ServerError,
  };
};

export const imageRouter = router({
  /**
   * In-chat Image tool generation. Same provider runtime + server-side
   * download/upload as the workspace flow above, but the result is a plain
   * files row (linked to the task via `metadata.chatImageTaskId`) instead of
   * a generation/batch asset — chat keeps inline message storage.
   */
  createChatImage: imageProcedure
    .input(
      z.object({
        model: z.string(),
        params: z.object({ prompt: z.string() }).passthrough(),
        provider: z.string(),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { taskId, provider, model, params } = input;

      const taskClaimed = await ctx.asyncTaskModel.claimPendingTask(taskId);
      if (!taskClaimed) return;

      const abortController = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      try {
        const run = async (signal: AbortSignal) => {
          const agentRuntime = await initModelRuntimeWithUserPayload(provider, ctx.jwtPayload);
          checkAbortSignal(signal);

          // ModelRuntime.createImage resolves to undefined when the provider's
          // delegate has no image support — surface that as a clear task error
          const response = await agentRuntime.createImage!({
            model,
            params: params as unknown as RuntimeImageGenParams,
          });
          if (!response) {
            throw new Error(`Provider "${provider}" does not support image creation.`);
          }
          checkAbortSignal(signal);

          const { imageUrl, width, height } = response;

          // ComfyUI result URLs are auth-protected — forward its headers to the
          // download, exactly like the workspace flow above does
          let authHeaders: Record<string, string> | undefined;
          if (provider === 'comfyui') {
            authHeaders = agentRuntime.getAuthHeaders();
          }

          const { image, thumbnailImage } = await ctx.generationService.transformImageForGeneration(
            imageUrl,
            authHeaders,
          );
          checkAbortSignal(signal);

          const uploaded = await ctx.generationService.uploadImageForGeneration(
            image,
            thumbnailImage,
          );
          checkAbortSignal(signal);

          await ctx.fileModel.create(
            {
              fileHash: image.hash,
              fileType: image.mime,
              metadata: {
                chatImageTaskId: taskId,
                height: height ?? image.height,
                path: uploaded.imageUrl,
                width: width ?? image.width,
              },
              name: `${params.prompt.slice(0, FILENAME_MAX_LENGTH)}.${image.extension}`,
              size: image.size,
              source: FileSource.ImageGeneration,
              url: uploaded.imageUrl,
            },
            true,
          );

          await ctx.asyncTaskModel.update(taskId, { status: AsyncTaskStatus.Success });
          return { success: true };
        };

        timeoutId = setTimeout(() => abortController.abort(), ASYNC_TASK_TIMEOUT);
        const result = await run(abortController.signal);
        clearTimeout(timeoutId);
        timeoutId = null;
        return result;
      } catch (error: any) {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        const { errorType, errorMessage } = categorizeError(error, abortController.signal.aborted);
        await ctx.asyncTaskModel.update(taskId, {
          error: new AsyncTaskError(errorType, errorMessage),
          status: AsyncTaskStatus.Error,
        });

        return {
          message: `Chat image generation ${taskId} failed: ${errorMessage}`,
          success: false,
        };
      }
    }),

  createImage: imageProcedure.input(createImageInputSchema).mutation(async ({ input, ctx }) => {
    const { taskId, generationId, provider, model, params } = input;
    const taskFields = createTaskDebugFields({ generationId, model, provider, taskId });

    const taskClaimed = await ctx.asyncTaskModel.claimPendingTask(taskId);
    logImageDebugSafe('task_status_settled', {
      ...taskFields,
      outcome: taskClaimed ? 'updated' : 'skipped',
      phase: 'start',
      taskStatus: taskClaimed ? AsyncTaskStatus.Processing : 'unchanged',
    });

    if (!taskClaimed) return;

    logImageDebugSafe('async_task_started', {
      ...taskFields,
      cfgConfigured: params.cfg !== undefined,
      height: params.height,
      imageReferenceCount: Array.isArray(params.imageUrls) ? params.imageUrls.length : 0,
      phase: 'async_task',
      seedConfigured: 'seed' in params,
      steps: params.steps,
      width: params.width,
    });
    logImageDebugVerbose('async_task_started', { model, params, provider });

    // Use AbortController to prevent resource leaks
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const imageGenerationPromise = async (signal: AbortSignal) => {
        logImageDebugSafe('provider_call_started', {
          ...taskFields,
          phase: 'runtime_initialization',
        });
        const agentRuntime = await initModelRuntimeWithUserPayload(provider, ctx.jwtPayload);

        // Check if operation has been cancelled
        checkAbortSignal(signal);
        logImageDebugSafe('provider_call_started', {
          ...taskFields,
          phase: 'provider_call',
        });
        const response = await agentRuntime.createImage!({
          model,
          params: params as unknown as RuntimeImageGenParams,
        });

        if (!response) {
          throw new Error('Create image response is empty');
        }

        // Check if operation has been cancelled
        checkAbortSignal(signal);

        logImageDebugSafe('provider_call_settled', {
          ...taskFields,
          height: response.height,
          imageUrlKind: response.imageUrl.startsWith('data:') ? 'data_uri' : 'remote',
          outcome: 'completed',
          phase: 'provider_call',
          width: response.width,
        });

        const { imageUrl, width, height } = response;

        // Extract ComfyUI authentication headers if provider is ComfyUI
        let authHeaders: Record<string, string> | undefined;
        if (provider === 'comfyui') {
          // Use the public interface method to get auth headers
          // This avoids accessing private members and exposing credentials
          authHeaders = agentRuntime.getAuthHeaders();
        }

        let transformedImages: Awaited<
          ReturnType<GenerationService['transformImageForGeneration']>
        >;
        try {
          transformedImages = await ctx.generationService.transformImageForGeneration(
            imageUrl,
            authHeaders,
          );
          logImageDebugSafe('transform_settled', {
            ...taskFields,
            image: {
              height: transformedImages.image.height,
              mime: transformedImages.image.mime,
              size: transformedImages.image.size,
              width: transformedImages.image.width,
            },
            outcome: 'completed',
            phase: 'transform',
            thumbnail: {
              height: transformedImages.thumbnailImage.height,
              mime: transformedImages.thumbnailImage.mime,
              size: transformedImages.thumbnailImage.size,
              width: transformedImages.thumbnailImage.width,
            },
          });
        } catch (error) {
          logImageDebugSafe('transform_settled', {
            ...taskFields,
            ...describeImageDebugError(error),
            failurePhase: 'transform',
            outcome: 'failed',
            phase: 'transform',
          });
          throw error;
        }
        const { image, thumbnailImage } = transformedImages;

        // Check if operation has been cancelled
        checkAbortSignal(signal);

        let uploaded: Awaited<ReturnType<GenerationService['uploadImageForGeneration']>>;
        try {
          uploaded = await ctx.generationService.uploadImageForGeneration(image, thumbnailImage);
          logImageDebugSafe('upload_settled', {
            ...taskFields,
            outcome: 'completed',
            phase: 'upload',
          });
        } catch (error) {
          logImageDebugSafe('upload_settled', {
            ...taskFields,
            ...describeImageDebugError(error),
            failurePhase: 'upload',
            outcome: 'failed',
            phase: 'upload',
          });
          throw error;
        }
        const { imageUrl: uploadedImageUrl, thumbnailImageUrl } = uploaded;

        // Check if operation has been cancelled
        checkAbortSignal(signal);

        await ctx.generationModel.createAssetAndFile(
          generationId,
          {
            height: height ?? image.height,
            originalUrl: imageUrl,
            thumbnailUrl: thumbnailImageUrl,
            type: 'image',
            url: uploadedImageUrl,
            width: width ?? image.width,
          },
          {
            fileHash: image.hash,
            fileType: image.mime,
            metadata: {
              generationId,
              height: image.height,
              path: uploadedImageUrl,
              width: image.width,
            },
            name: `${params.prompt.slice(0, FILENAME_MAX_LENGTH)}.${image.extension}`,
            // Use first 50 characters of prompt as filename
            size: image.size,
            url: uploadedImageUrl,
          },
        );
        logImageDebugSafe('task_status_settled', {
          ...taskFields,
          outcome: 'completed',
          phase: 'asset_persistence',
        });

        await ctx.asyncTaskModel.update(taskId, {
          status: AsyncTaskStatus.Success,
        });
        logImageDebugSafe('task_status_settled', {
          ...taskFields,
          outcome: 'updated',
          phase: 'complete',
          taskStatus: AsyncTaskStatus.Success,
        });
        return { success: true };
      };

      // Set timeout to cancel operation and prevent resource leaks
      timeoutId = setTimeout(() => {
        abortController.abort();
      }, ASYNC_TASK_TIMEOUT);

      const result = await imageGenerationPromise(abortController.signal);

      // Clean up timeout timer
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      return result;
    } catch (error: any) {
      // Clean up timeout timer
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      // Improved error categorization logic
      const { errorType, errorMessage } = categorizeError(error, abortController.signal.aborted);

      logImageDebugSafe('provider_call_settled', {
        ...taskFields,
        ...describeImageDebugError(error),
        errorType,
        outcome: 'failed',
        phase: 'error_categorization',
      });

      await ctx.asyncTaskModel.update(taskId, {
        error: new AsyncTaskError(errorType, errorMessage),
        status: AsyncTaskStatus.Error,
      });
      logImageDebugSafe('task_status_settled', {
        ...taskFields,
        errorType,
        outcome: 'updated',
        phase: 'error',
        taskStatus: AsyncTaskStatus.Error,
      });

      return {
        message: `Image generation ${taskId} failed: ${errorMessage}`,
        success: false,
      };
    }
  }),
});
