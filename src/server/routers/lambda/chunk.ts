import {
  KnowledgeBaseClientPreparationFailurePhaseSchema,
  KnowledgeBasePromptTokenCountModeSchema,
  SemanticSearchSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { files, knowledgeBaseFiles, knowledgeBases } from '@/database/schemas';
import {
  createKnowledgeDiagnosticId,
  describeKnowledgeDebugError,
  getKnowledgeDebugContext,
  isKnowledgeDebugEnabled,
  logKnowledgeDebugSafe,
  logKnowledgeDebugVerbose,
  normalizeKnowledgeDiagnosticId,
  runWithKnowledgeDebugOperation,
} from '@/libs/logger/knowledgeDebug';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { keyVaults, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ChunkService } from '@/server/services/chunk';
import {
  RagEmbeddingService,
  RagProviderNotConfiguredError,
  resolveRagEmbeddingConfig,
} from '@/server/services/rag';

const chunkProcedure = authedProcedure
  .use(serverDatabase)
  .use(keyVaults)
  .use(async (opts) => {
    const { ctx } = opts;

    return opts.next({
      ctx: {
        asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
        chunkModel: new ChunkModel(ctx.serverDB, ctx.userId),
        chunkService: new ChunkService(ctx.serverDB, ctx.userId),
        embeddingModel: new EmbeddingModel(ctx.serverDB, ctx.userId),
        fileModel: new FileModel(ctx.serverDB, ctx.userId),
        messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      },
    });
  });

export const chunkRouter = router({
  createEmbeddingChunksTask: chunkProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asyncTaskId = await ctx.chunkService.asyncEmbeddingFileChunks(input.id, ctx.jwtPayload);

      return { id: asyncTaskId, success: true };
    }),

  createParseFileTask: chunkProcedure
    .input(
      z.object({
        id: z.string(),
        skipExist: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asyncTaskId = await ctx.chunkService.asyncParseFileToChunks(
        input.id,
        ctx.jwtPayload,
        input.skipExist,
      );

      return { id: asyncTaskId, success: true };
    }),

  getChunksByFileId: chunkProcedure
    .input(
      z.object({
        cursor: z.number().nullish(),
        id: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return {
        items: await ctx.chunkModel.findByFileId(input.id, input.cursor || 0),
        nextCursor: input.cursor ? input.cursor + 1 : 1,
      };
    }),

  reportKnowledgeClientEvent: chunkProcedure
    .input(
      z.object({
        chunkCount: z.number().int().nonnegative().max(10_000).optional(),
        countMode: KnowledgeBasePromptTokenCountModeSchema.optional(),
        diagnosticId: z.string().max(64).optional(),
        event: z.enum(['client_preparation_failed', 'prompt_injection_reported']),
        failurePhase: KnowledgeBaseClientPreparationFailurePhaseSchema.optional(),
        promptTokens: z.number().int().nonnegative().max(10_000_000).optional(),
        queryRewritten: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (!isKnowledgeDebugEnabled()) return { diagnosticId: undefined };

      const diagnosticId =
        normalizeKnowledgeDiagnosticId(input.diagnosticId) || createKnowledgeDiagnosticId();
      return runWithKnowledgeDebugOperation(
        { diagnosticId, operation: input.event, runtime: 'lambda', transport: 'trpc' },
        async () => {
          logKnowledgeDebugSafe(input.event, {
            chunkCount: input.chunkCount,
            countMode: input.countMode,
            failurePhase: input.failurePhase,
            outcome: input.event === 'client_preparation_failed' ? 'failed' : 'completed',
            phase: 'client_prompt_preparation',
            promptTokens: input.promptTokens,
            queryRewritten: input.queryRewritten,
          });
          return { diagnosticId };
        },
      );
    }),

  retryParseFileTask: chunkProcedure
    .input(
      z.object({
        id: z.string(),
        service: z.enum(['markitdown']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.fileModel.findById(input.id);

      if (!result) return;

      // 1. delete the previous task if exist
      if (result.chunkTaskId) {
        await ctx.asyncTaskModel.delete(result.chunkTaskId);
      }

      // 2. create a new asyncTask for chunking
      const asyncTaskId = await ctx.chunkService.asyncParseFileToChunks(
        input.id,
        ctx.jwtPayload,
        undefined,
        input.service,
      );

      return { id: asyncTaskId, success: true };
    }),

  semanticSearch: chunkProcedure
    .input(
      z.object({
        fileIds: z.array(z.string()).optional(),
        query: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const resolved = await resolveRagEmbeddingConfig(ctx.serverDB, ctx.userId);
      if (!resolved.config || !resolved.fingerprint) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: new RagProviderNotConfiguredError().message,
        });
      }
      const embeddingService = new RagEmbeddingService(resolved.config);

      const embeddings = await embeddingService.embed(input.query, 'query');

      return ctx.chunkModel.semanticSearch({
        embedding: embeddings[0],
        fileIds: input.fileIds,
        fingerprint: resolved.fingerprint,
        query: input.query,
      });
    }),

  semanticSearchForChat: chunkProcedure
    .input(SemanticSearchSchema)
    .mutation(async ({ ctx, input }) => {
      const diagnosticId = isKnowledgeDebugEnabled() ? createKnowledgeDiagnosticId() : undefined;

      return runWithKnowledgeDebugOperation(
        { diagnosticId, operation: 'chat_retrieval', runtime: 'lambda', transport: 'trpc' },
        async () => {
          const startedAt = Date.now();
          logKnowledgeDebugSafe('retrieval_started', {
            directFileCount: input.fileIds?.length ?? 0,
            knowledgeBaseCount: input.knowledgeIds?.length ?? 0,
            phase: 'retrieval',
            queryCharacters: input.rewriteQuery.length,
            queryRewritten: input.rewriteQuery !== input.userQuery,
          });
          try {
            const resolved = await resolveRagEmbeddingConfig(ctx.serverDB, ctx.userId);
            if (!resolved.config || !resolved.fingerprint) {
              throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: new RagProviderNotConfiguredError().message,
              });
            }
            const embeddingService = new RagEmbeddingService(resolved.config);
            const item = await ctx.messageModel.findMessageQueriesById(input.messageId);
            let embedding: number[];
            let ragQueryId: string;
            let queryEmbeddingCacheHit = true;

            // if there is no message rag or it's embeddings, then we need to create one
            if (
              !item ||
              !item.embeddings ||
              item.embeddingModel !== resolved.fingerprint ||
              item.rewriteQuery !== input.rewriteQuery
            ) {
              queryEmbeddingCacheHit = false;
              // slice content to make sure in the context window limit
              const query =
                input.rewriteQuery.length > 8000
                  ? input.rewriteQuery.slice(0, 8000)
                  : input.rewriteQuery;

              const embeddings = await embeddingService.embed(query, 'query');

              embedding = embeddings[0];
              const embeddingsId = await ctx.embeddingModel.create({
                embeddings: embedding,
                model: resolved.fingerprint,
              });

              const result = await ctx.messageModel.replaceMessageQuery({
                embeddingsId,
                messageId: input.messageId,
                rewriteQuery: input.rewriteQuery,
                userQuery: input.userQuery,
              });

              ragQueryId = result.id;
            } else {
              embedding = item.embeddings;
              ragQueryId = item.id;
            }

            logKnowledgeDebugSafe('query_embedding_settled', {
              cacheHit: queryEmbeddingCacheHit,
              dimensions: embedding.length,
              outcome: 'completed',
              phase: 'query_embedding',
            });

            let finalFileIds = input.fileIds ?? [];

            if (input.knowledgeIds && input.knowledgeIds.length > 0) {
              const knowledgeFiles = await ctx.serverDB
                .select({ fileId: knowledgeBaseFiles.fileId })
                .from(knowledgeBaseFiles)
                .innerJoin(
                  knowledgeBases,
                  and(
                    eq(knowledgeBases.id, knowledgeBaseFiles.knowledgeBaseId),
                    eq(knowledgeBases.userId, ctx.userId),
                  ),
                )
                .innerJoin(
                  files,
                  and(eq(files.id, knowledgeBaseFiles.fileId), eq(files.userId, ctx.userId)),
                )
                .where(
                  and(
                    inArray(knowledgeBaseFiles.knowledgeBaseId, input.knowledgeIds),
                    eq(knowledgeBaseFiles.userId, ctx.userId),
                  ),
                );

              finalFileIds = Array.from(
                new Set(knowledgeFiles.map((f) => f.fileId).concat(finalFileIds)),
              );
            }

            logKnowledgeDebugSafe('scope_expansion_settled', {
              directFileCount: input.fileIds?.length ?? 0,
              expandedFileCount: finalFileIds.length,
              knowledgeBaseCount: input.knowledgeIds?.length ?? 0,
              outcome: 'completed',
              phase: 'scope_expansion',
            });
            logKnowledgeDebugVerbose('scope_expansion_settled', {
              directFileIds: input.fileIds,
              expandedFileIds: finalFileIds,
              knowledgeBaseIds: input.knowledgeIds,
            });

            const { chunks, stats } = await ctx.chunkModel.semanticSearchForChatWithStats({
              embedding,
              fileIds: finalFileIds,
              fingerprint: resolved.fingerprint,
              query: input.rewriteQuery,
            });

            // TODO: need to rerank the chunks

            logKnowledgeDebugSafe('vector_search_settled', {
              ...stats,
              outcome: 'completed',
              phase: 'vector_search',
            });
            logKnowledgeDebugSafe('retrieval_settled', {
              durationMs: Date.now() - startedAt,
              outcome: 'completed',
              phase: 'retrieval',
              selectedCount: stats.selectedCount,
            });

            return {
              chunks,
              diagnosticId: getKnowledgeDebugContext()?.diagnosticId,
              queryId: ragQueryId,
              retrieval: stats,
              scope: {
                directFileCount: input.fileIds?.length ?? 0,
                expandedFileCount: finalFileIds.length,
                knowledgeBaseCount: input.knowledgeIds?.length ?? 0,
              },
            };
          } catch (e) {
            console.error(e);

            logKnowledgeDebugSafe('retrieval_settled', {
              ...describeKnowledgeDebugError(e),
              durationMs: Date.now() - startedAt,
              failurePhase: 'retrieval',
              outcome: 'failed',
              phase: 'retrieval',
            });

            const suffix = diagnosticId ? ` (Diagnostic ID: ${diagnosticId})` : '';

            if (e instanceof TRPCError) {
              throw new TRPCError({ code: e.code, message: `${e.message}${suffix}` });
            }

            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: `${(e as any).errorType || (e as Error).message || String(e)}${suffix}`,
            });
          }
        },
      );
    }),
});
