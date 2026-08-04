import { isChunkableFile } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import { chunk } from 'lodash-es';
import pMap from 'p-map';
import { z } from 'zod';

import { ASYNC_TASK_TIMEOUT, AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { NewChunkItem, NewEmbeddingsItem, NewUnstructuredChunkItem } from '@/database/schemas';
import { fileEnv } from '@/envs/file';
import {
  describeKnowledgeDebugError,
  getKnowledgeDebugContext,
  logKnowledgeDebugSafe,
  logKnowledgeDebugVerbose,
} from '@/libs/logger/knowledgeDebug';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { isStorageObjectMissingError } from '@/server/modules/S3/error';
import { ChunkService } from '@/server/services/chunk';
import { FileService } from '@/server/services/file';
import {
  RagEmbeddingService,
  RagProviderNotConfiguredError,
  resolveRagEmbeddingConfig,
} from '@/server/services/rag';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';
import { safeParseJSON } from '@/utils/safeParseJSON';
import { sanitizeUTF8 } from '@/utils/sanitizeUTF8';

const fileProcedure = asyncAuthedProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      chunkModel: new ChunkModel(ctx.serverDB, ctx.userId),
      chunkService: new ChunkService(ctx.serverDB, ctx.userId),
      embeddingModel: new EmbeddingModel(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      fileService: new FileService(ctx.serverDB, ctx.userId),
    },
  });
});

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const candidate = error as { body?: unknown; message?: unknown };
    if (typeof candidate.message === 'string') return candidate.message;
    if (
      candidate.body &&
      typeof candidate.body === 'object' &&
      typeof (candidate.body as { detail?: unknown }).detail === 'string'
    ) {
      return (candidate.body as { detail: string }).detail;
    }
    if (typeof candidate.body === 'string') return candidate.body;
  }
  return String(error);
};

export const fileRouter = router({
  embeddingChunks: fileProcedure
    .input(
      z.object({
        fileId: z.string(),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.fileModel.findById(input.fileId);

      if (!file) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
      }
      if (!isChunkableFile(file.name, file.fileType)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This file format is not supported by the Knowledge Base chunkers.',
        });
      }

      const asyncTask = await ctx.asyncTaskModel.findById(input.taskId);

      if (!asyncTask) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Async Task not found' });

      try {
        const taskStartedAt = Date.now();
        logKnowledgeDebugSafe('reindex_started', {
          phase: 'embedding_task',
          taskId: input.taskId,
        });
        logKnowledgeDebugVerbose('reindex_started', {
          fileId: input.fileId,
          fileName: file.name,
          fileType: file.fileType,
          storageUrl: file.url,
          taskId: input.taskId,
        });
        const resolved = await resolveRagEmbeddingConfig(ctx.serverDB, ctx.userId);
        if (!resolved.config || !resolved.fingerprint) {
          throw new RagProviderNotConfiguredError();
        }
        const embeddingService = new RagEmbeddingService(resolved.config);

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(
              new AsyncTaskError(
                AsyncTaskErrorType.Timeout,
                'embedding task is timeout, please try again',
              ),
            );
          }, ASYNC_TASK_TIMEOUT);
        });

        const embeddingPromise = async () => {
          // update the task status to success
          await ctx.asyncTaskModel.update(input.taskId, {
            status: AsyncTaskStatus.Processing,
          });

          const startAt = Date.now();

          const CHUNK_SIZE = 50;
          const CONCURRENCY = 3;

          const chunks = await ctx.chunkModel.getChunksTextByFileId(input.fileId);
          const requestArray = chunk(chunks, CHUNK_SIZE);
          try {
            await pMap(
              requestArray,
              async (chunks, index) => {
                const batchStartedAt = Date.now();

                const vectors = await embeddingService.embed(
                  chunks.map((c) => c.text),
                  'document',
                );

                const items: NewEmbeddingsItem[] = vectors.map((e, idx) => ({
                  chunkId: chunks[idx].id,
                  embeddings: e,
                  model: resolved.fingerprint!,
                }));

                await ctx.embeddingModel.bulkCreate(items, {
                  fileId: input.fileId,
                  taskId: input.taskId,
                });

                logKnowledgeDebugSafe('embedding_batch_settled', {
                  batchIndex: index,
                  chunkCount: chunks.length,
                  durationMs: Date.now() - batchStartedAt,
                  outcome: 'completed',
                  phase: 'embedding_batch',
                  vectorCount: vectors.length,
                });
              },
              { concurrency: CONCURRENCY },
            );
          } catch (e) {
            throw new AsyncTaskError(AsyncTaskErrorType.EmbeddingError, getErrorMessage(e));
          }

          const embeddedCount = await ctx.embeddingModel.countByFileId(
            input.fileId,
            resolved.fingerprint!,
          );
          if (embeddedCount !== chunks.length) {
            throw new Error(
              'Embedding coverage is incomplete; the file remains unavailable to RAG.',
            );
          }

          const duration = Date.now() - startAt;
          // update the task status to success
          await ctx.asyncTaskModel.update(input.taskId, {
            duration,
            status: AsyncTaskStatus.Success,
          });

          logKnowledgeDebugSafe('embedding_task_settled', {
            batchCount: requestArray.length,
            chunkCount: chunks.length,
            durationMs: Date.now() - taskStartedAt,
            outcome: 'completed',
            phase: 'embedding_task',
          });
          logKnowledgeDebugSafe('reindex_settled', {
            durationMs: Date.now() - taskStartedAt,
            outcome: 'completed',
            phase: 'embedding_task',
          });

          return { success: true };
        };

        // Race between the chunking process and the timeout
        return await Promise.race([embeddingPromise(), timeoutPromise]);
      } catch (e) {
        console.error('embeddingChunks error', e);

        logKnowledgeDebugSafe('embedding_task_settled', {
          ...describeKnowledgeDebugError(e),
          outcome: 'failed',
          phase: 'embedding_task',
        });
        logKnowledgeDebugSafe('reindex_settled', {
          ...describeKnowledgeDebugError(e),
          outcome: 'failed',
          phase: 'embedding_task',
        });

        await ctx.asyncTaskModel.update(input.taskId, {
          error: new AsyncTaskError(
            (e as Error).name,
            getErrorMessage(e),
            getKnowledgeDebugContext()?.diagnosticId,
          ),
          status: AsyncTaskStatus.Error,
        });

        return {
          message: `File ${file.name}(${input.taskId}) failed to embedding: ${getErrorMessage(e)}`,
          success: false,
        };
      }
    }),

  parseFileToChunks: fileProcedure
    .input(
      z.object({
        fileId: z.string(),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.fileModel.findById(input.fileId);
      if (!file) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
      }
      if (!isChunkableFile(file.name, file.fileType)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This file format is not supported by the Knowledge Base chunkers.',
        });
      }

      const asyncTask = await ctx.asyncTaskModel.findById(input.taskId);

      if (!asyncTask) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Async Task not found' });

      try {
        const startAt = Date.now();
        logKnowledgeDebugSafe('chunking_started', {
          phase: 'chunking',
          taskId: input.taskId,
        });
        logKnowledgeDebugVerbose('chunking_started', {
          fileId: input.fileId,
          fileName: file.name,
          fileType: file.fileType,
          storageUrl: file.url,
          taskId: input.taskId,
        });

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(
              new AsyncTaskError(
                AsyncTaskErrorType.Timeout,
                'chunking task is timeout, please try again',
              ),
            );
          }, ASYNC_TASK_TIMEOUT);
        });

        const chunkingPromise = async () => {
          const chunkService = ctx.chunkService;
          // update the task status to processing
          await ctx.asyncTaskModel.update(input.taskId, { status: AsyncTaskStatus.Processing });

          const storageStartedAt = Date.now();
          let content: Uint8Array;
          try {
            content = await ctx.fileService.getFileByteArray(file.url);
            logKnowledgeDebugSafe('storage_read_settled', {
              byteCount: content.byteLength,
              durationMs: Date.now() - storageStartedAt,
              outcome: 'completed',
              phase: 'storage_read',
            });
          } catch (error) {
            logKnowledgeDebugSafe('storage_read_settled', {
              ...describeKnowledgeDebugError(error),
              durationMs: Date.now() - storageStartedAt,
              outcome: 'failed',
              phase: 'storage_read',
            });
            throw error;
          }
          if (!content) {
            throw new AsyncTaskError(
              AsyncTaskErrorType.ServerError,
              'The source file is empty in object storage. Re-upload it to restore this document.',
            );
          }

          // partition file to chunks
          const chunkResult = await chunkService.chunkContent({
            content,
            fileType: file.fileType,
            filename: file.name,
          });

          // after finish partition, we need to filter out some elements
          const chunks = chunkResult.chunks
            .map(({ text, ...item }): NewChunkItem => ({
              ...item,
              text: text ? sanitizeUTF8(text).trim() : '',
              userId: ctx.userId,
            }))
            .filter(({ text }) => !!text);

          const duration = Date.now() - startAt;

          // if no chunk found, throw error
          if (chunks.length === 0) {
            throw {
              message:
                'No chunk found in this file. it may due to current chunking method can not parse file accurately',
              name: AsyncTaskErrorType.NoChunkError,
            };
          }

          const unstructuredChunks = (chunkResult.unstructuredChunks || [])
            .map(({ text, ...item }): NewUnstructuredChunkItem => ({
              ...item,
              fileId: input.fileId,
              text: text ? sanitizeUTF8(text).trim() : '',
              userId: ctx.userId,
            }))
            .filter(({ text }) => !!text);

          await ctx.chunkModel.replaceFileChunks(chunks, input.fileId, unstructuredChunks);

          // update the task status to success
          await ctx.asyncTaskModel.update(input.taskId, {
            duration,
            status: AsyncTaskStatus.Success,
          });

          logKnowledgeDebugSafe('chunking_settled', {
            chunkCount: chunks.length,
            durationMs: duration,
            outcome: 'completed',
            phase: 'chunking',
            unstructuredChunkCount: unstructuredChunks.length,
          });

          // if enable auto embedding, trigger the embedding task
          const resolved = await resolveRagEmbeddingConfig(ctx.serverDB, ctx.userId);
          if (fileEnv.CHUNKS_AUTO_EMBEDDING && resolved.config) {
            await chunkService.asyncEmbeddingFileChunks(input.fileId, ctx.jwtPayload);
          }

          return { success: true };
        };
        // Race between the chunking process and the timeout
        return await Promise.race([chunkingPromise(), timeoutPromise]);
      } catch (e) {
        const error = e as any;

        const parsedErrorBody =
          typeof error.body === 'string' ? (safeParseJSON(error.body) ?? error.body) : error.body;
        const asyncTaskError = isStorageObjectMissingError(error)
          ? new AsyncTaskError(
              AsyncTaskErrorType.ServerError,
              'The source file is missing from object storage. Re-upload it to restore this document.',
              getKnowledgeDebugContext()?.diagnosticId,
            )
          : error.body
            ? new AsyncTaskError(
                error.name,
                parsedErrorBody &&
                  typeof parsedErrorBody === 'object' &&
                  typeof parsedErrorBody.detail === 'string'
                  ? parsedErrorBody.detail
                  : typeof parsedErrorBody === 'string'
                    ? parsedErrorBody
                    : getErrorMessage(error),
                getKnowledgeDebugContext()?.diagnosticId,
              )
            : new AsyncTaskError(
                (error as Error).name,
                getErrorMessage(error),
                getKnowledgeDebugContext()?.diagnosticId,
              );

        logKnowledgeDebugSafe('chunking_settled', {
          ...describeKnowledgeDebugError(error),
          outcome: 'failed',
          phase: 'chunking',
        });

        console.error('[Chunking Error]', asyncTaskError);
        await ctx.asyncTaskModel.update(input.taskId, {
          error: asyncTaskError,
          status: AsyncTaskStatus.Error,
        });

        return {
          message: `File ${file.name}(${input.taskId}) failed to chunking: ${getErrorMessage(e)}`,
          success: false,
        };
      }
    }),
});
