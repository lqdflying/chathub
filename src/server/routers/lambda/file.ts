import { isChunkableFile } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import { sha256 } from 'js-sha256';
import { z } from 'zod';

import { serverDBEnv } from '@/config/db';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { appEnv } from '@/envs/app';
import {
  describeKnowledgeDebugError,
  logKnowledgeDebugSafe,
  logKnowledgeDebugVerbose,
  runWithKnowledgeDebugOperation,
} from '@/libs/logger/knowledgeDebug';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { extractKeyFromAppFileProxyUrl } from '@/server/services/file/fileReference';
import { canonicalStorageKey } from '@/server/services/file/impls/utils';
import { isUserUploadKey } from '@/server/services/file/uploadTarget';
import { resolveRagEmbeddingConfig } from '@/server/services/rag';
import { AsyncTaskStatus, AsyncTaskType } from '@/types/asyncTask';
import { FileListItem, FileSource, QueryFileListSchema, UploadFileSchema } from '@/types/files';

const fileProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      chunkModel: new ChunkModel(ctx.serverDB, ctx.userId),
      embeddingModel: new EmbeddingModel(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      fileService: new FileService(ctx.serverDB, ctx.userId),
    },
  });
});

const imageArtifactListInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(60).default(40),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});

const isDesktopFileUrl = (url: string) =>
  /^desktop:\/\/[\da-z][\w./-]*$/i.test(url) &&
  !url.split('/').some((segment) => segment === '..' || segment === '.');

const isReusableStoredFile = async (fileService: FileService, url?: string) => {
  if (!url) return false;
  if (isDesktopFileUrl(url)) return true;

  return fileService.hasFile(url);
};

const verifyUploadedFileHash = async (fileService: FileService, url: string, hash: string) => {
  const content = await fileService.getFileByteArray(url);
  if (sha256(content) !== hash.toLowerCase()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'uploaded file hash mismatch' });
  }
};

export const fileRouter = router({
  checkFileHash: fileProcedure
    .input(z.object({ hash: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const globalFile = await ctx.fileModel.checkHash(input.hash);
      if (!globalFile?.isExist) return globalFile;

      return (await isReusableStoredFile(ctx.fileService, globalFile.url))
        ? globalFile
        : { isExist: false };
    }),

  createFile: fileProcedure
    .input(
      UploadFileSchema.omit({ hash: true, url: true }).extend({
        hash: z.string().regex(/^[\da-f]{64}$/i, 'invalid file hash'),
        // The URL stored in a files row is later trusted by proxy and image ownership checks.
        // Reject malformed shapes before the mutation applies its scoped-key or hash-canonical
        // ownership rule.
        url: z
          .string()
          .max(1024)
          .refine(
            (url) =>
              !url.includes('\\') &&
              // eslint-disable-next-line no-control-regex
              !/[\u0000-\u001F]/.test(url) &&
              !url.startsWith('/') &&
              !url.split('/').some((segment) => segment === '..' || segment === '.'),
            { message: 'invalid file url' },
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return runWithKnowledgeDebugOperation(
        { operation: 'document_registration', runtime: 'lambda', transport: 'trpc' },
        async () => {
          const startedAt = Date.now();
          try {
            const isKnowledgeBaseUpload = input.knowledgeBaseUpload || !!input.knowledgeBaseId;
            if (isKnowledgeBaseUpload && !isChunkableFile(input.name, input.fileType)) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message:
                  'Only documents supported by the chunking loaders can be added to a Knowledge Base.',
              });
            }

            const globalFile = await ctx.fileModel.checkHash(input.hash);
            if (!globalFile)
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid file hash' });

            const reuseGlobalFile =
              globalFile.isExist && (await isReusableStoredFile(ctx.fileService, globalFile.url));

            if (
              !reuseGlobalFile &&
              !isUserUploadKey(input.url, ctx.userId, 'file') &&
              !isDesktopFileUrl(input.url)
            ) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid file url' });
            }

            if (globalFile.isExist && !reuseGlobalFile) {
              // Repairing a global hash updates every deduplicated file row. Require a server-readable,
              // user-scoped object and verify its bytes before changing those shared references.
              if (!isUserUploadKey(input.url, ctx.userId, 'file')) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid file url' });
              }
              await verifyUploadedFileHash(ctx.fileService, input.url, input.hash);
              await ctx.fileModel.repairGlobalFile(input.hash, {
                fileType: input.fileType,
                metadata: input.metadata,
                size: input.size,
                url: input.url,
              });
            }

            const canonicalUrl = reuseGlobalFile ? globalFile.url : input.url;
            if (!canonicalUrl) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid file url' });
            }
            const resolvedFileType = reuseGlobalFile
              ? (globalFile.fileType ?? input.fileType)
              : input.fileType;
            if (isKnowledgeBaseUpload && !isChunkableFile(input.name, resolvedFileType)) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message:
                  'Only documents supported by the chunking loaders can be added to a Knowledge Base.',
              });
            }

            const { id } = await ctx.fileModel.create(
              {
                fileHash: input.hash,
                fileType: resolvedFileType,
                knowledgeBaseId: input.knowledgeBaseId,
                metadata: reuseGlobalFile
                  ? (globalFile.metadata ?? input.metadata)
                  : input.metadata,
                name: input.name,
                size: reuseGlobalFile ? (globalFile.size ?? input.size) : input.size,
                source: isKnowledgeBaseUpload ? FileSource.KnowledgeBase : undefined,
                url: canonicalUrl,
              },
              // if the file is not exist in global file, create a new one
              !globalFile.isExist,
            );

            const result = { id, url: await ctx.fileService.getUIFileUrl(canonicalUrl) };
            logKnowledgeDebugSafe('document_registration_settled', {
              attachedToKnowledgeBase: !!input.knowledgeBaseId,
              durationMs: Date.now() - startedAt,
              fileBytes: input.size,
              outcome: 'completed',
              phase: 'document_registration',
              repairedStoredObject: globalFile.isExist && !reuseGlobalFile,
              reusedStoredObject: reuseGlobalFile,
            });
            logKnowledgeDebugVerbose('document_registration_settled', {
              fileHash: input.hash,
              fileId: id,
              fileName: input.name,
              knowledgeBaseId: input.knowledgeBaseId,
              storageUrl: canonicalUrl,
            });
            return result;
          } catch (error) {
            logKnowledgeDebugSafe('document_registration_settled', {
              ...describeKnowledgeDebugError(error),
              durationMs: Date.now() - startedAt,
              outcome: 'failed',
              phase: 'document_registration',
            });
            logKnowledgeDebugVerbose('document_registration_settled', {
              fileHash: input.hash,
              fileName: input.name,
              knowledgeBaseId: input.knowledgeBaseId,
              storageUrl: input.url,
            });
            throw error;
          }
        },
      );
    }),
  findById: fileProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const item = await ctx.fileModel.findById(input.id);
      if (!item) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });

      return { ...item, url: await ctx.fileService.getUIFileUrl(item?.url) };
    }),

  getFileItemById: fileProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .query(async ({ ctx, input }): Promise<FileListItem | undefined> => {
      const item = await ctx.fileModel.findById(input.id);

      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });

      let embeddingTask = null;
      if (item.embeddingTaskId) {
        embeddingTask = await ctx.asyncTaskModel.findById(item.embeddingTaskId);
      }
      let chunkingTask = null;
      if (item.chunkTaskId) {
        chunkingTask = await ctx.asyncTaskModel.findById(item.chunkTaskId);
      }

      const chunkCount = await ctx.chunkModel.countByFileId(input.id);
      const ragConfig = await resolveRagEmbeddingConfig(ctx.serverDB, ctx.userId);
      const embeddedCount = ragConfig.fingerprint
        ? await ctx.embeddingModel.countByFileId(input.id, ragConfig.fingerprint)
        : 0;

      return {
        ...item,
        chunkCount,
        chunkingError: chunkingTask?.error,
        chunkingStatus: chunkingTask?.status as AsyncTaskStatus,
        embeddingError: embeddingTask?.error,
        embeddingStatus: embeddingTask?.status as AsyncTaskStatus,
        finishEmbedding:
          chunkCount > 0 &&
          embeddingTask?.status === AsyncTaskStatus.Success &&
          embeddedCount === chunkCount,
        url: await ctx.fileService.getUIFileUrl(item.url!),
      };
    }),

  getFiles: fileProcedure.input(QueryFileListSchema).query(async ({ ctx, input }) => {
    const fileList = await ctx.fileModel.query(input);

    const fileIds = fileList.map((item) => item.id);
    const chunks = await ctx.chunkModel.countByFileIds(fileIds);
    const ragConfig = await resolveRagEmbeddingConfig(ctx.serverDB, ctx.userId);
    const embeddedCounts = ragConfig.fingerprint
      ? await ctx.embeddingModel.countByFileIds(fileIds, ragConfig.fingerprint)
      : [];

    const chunkTaskIds = fileList.map((result) => result.chunkTaskId).filter(Boolean) as string[];

    const chunkTasks = await ctx.asyncTaskModel.findByIds(chunkTaskIds, AsyncTaskType.Chunking);

    const embeddingTaskIds = fileList
      .map((result) => result.embeddingTaskId)
      .filter(Boolean) as string[];
    const embeddingTasks = await ctx.asyncTaskModel.findByIds(
      embeddingTaskIds,
      AsyncTaskType.Embedding,
    );

    const resultFiles = [] as any[];
    for (const { chunkTaskId, embeddingTaskId, ...item } of fileList as any[]) {
      const chunkTask = chunkTaskId ? chunkTasks.find((task) => task.id === chunkTaskId) : null;
      const embeddingTask = embeddingTaskId
        ? embeddingTasks.find((task) => task.id === embeddingTaskId)
        : null;
      const chunkCount = chunks.find((chunk) => chunk.id === item.id)?.count ?? 0;
      const embeddedCount = embeddedCounts.find((count) => count.id === item.id)?.count ?? 0;

      const fileItem = {
        ...item,
        chunkCount: chunkCount || null,
        chunkingError: chunkTask?.error ?? null,
        chunkingStatus: chunkTask?.status as AsyncTaskStatus,
        embeddingError: embeddingTask?.error ?? null,
        embeddingStatus: embeddingTask?.status as AsyncTaskStatus,
        finishEmbedding:
          chunkCount > 0 &&
          embeddingTask?.status === AsyncTaskStatus.Success &&
          embeddedCount === chunkCount,
        url: await ctx.fileService.getUIFileUrl(item.url!),
      } as FileListItem;
      resultFiles.push(fileItem);
    }

    return resultFiles;
  }),

  getImageArtifacts: fileProcedure
    .input(imageArtifactListInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await ctx.fileModel.queryImageArtifacts(input);
      const items = await Promise.all(
        result.items.map(async (item) => ({
          ...item,
          url: await ctx.fileService.getUIFileUrl(item.url),
        })),
      );

      return { ...result, items };
    }),

  removeAllFiles: fileProcedure.mutation(async ({ ctx }) => {
    return ctx.fileModel.clear();
  }),

  removeFile: fileProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const file = await ctx.fileModel.delete(input.id, serverDBEnv.REMOVE_GLOBAL_FILE);

    if (!file) return;

    // delele the file from remove from S3 if it is not used by other files
    await ctx.fileService.deleteFile(file.url!);
  }),

  removeFileAsyncTask: fileProcedure
    .input(
      z.object({
        id: z.string(),
        type: z.enum(['embedding', 'chunk']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.fileModel.findById(input.id);

      if (!file) return;

      const taskId = input.type === 'embedding' ? file.embeddingTaskId : file.chunkTaskId;

      if (!taskId) return;

      await ctx.asyncTaskModel.delete(taskId);
    }),

  removeFiles: fileProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      const needToRemoveFileList = await ctx.fileModel.deleteMany(
        input.ids,
        serverDBEnv.REMOVE_GLOBAL_FILE,
      );

      if (!needToRemoveFileList || needToRemoveFileList.length === 0) return;

      // remove from S3
      await ctx.fileService.deleteFiles(needToRemoveFileList.map((file) => file.url!));
    }),

  removeImageArtifacts: fileProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(60) }))
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.fileModel.deleteImageArtifacts(
        input.ids,
        serverDBEnv.REMOVE_GLOBAL_FILE,
      );

      if (result.deletedIds.length === 0) {
        return { cleanupFailed: false, deletedIds: [] };
      }

      const storageKeys = [
        ...new Set(
          result.storageKeys.flatMap((key) => {
            const canonicalKey = canonicalStorageKey(key);
            return canonicalKey ? [canonicalKey] : [];
          }),
        ),
      ];

      if (storageKeys.length === 0) {
        return { cleanupFailed: false, deletedIds: result.deletedIds };
      }

      try {
        await ctx.fileService.deleteFiles(storageKeys);
        return { cleanupFailed: false, deletedIds: result.deletedIds };
      } catch (error) {
        // Match Image history / generation-batch cleanup: the database commit is
        // authoritative. Storage deletion is best-effort after that commit.
        console.error('Failed to delete artifact files from S3:', error);
        return { cleanupFailed: true, deletedIds: result.deletedIds };
      }
    }),

  resolvePublicUrl: fileProcedure
    .input(z.object({ url: z.string() }))
    .query(async ({ ctx, input }) => {
      const key = extractKeyFromAppFileProxyUrl(input.url, appEnv.APP_URL);
      if (!key) return input.url;

      const candidates = await ctx.fileModel.findUrlCandidatesByKey(key);
      const owned = candidates.some(
        // exact match: normal rows store the bare key; legacy rows store the full URL
        (url) => url === key || ctx.fileService.getKeyFromFullUrl(url) === key,
      );
      if (!owned) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'file_not_found' });
      }

      return ctx.fileService.getFullFileUrl(key);
    }),
});

export type FileRouter = typeof fileRouter;
