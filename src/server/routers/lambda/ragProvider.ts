import type { RagProviderConfig, RagProviderUpdate } from '@lobechat/types';
import { RagProviderUpdateSchema } from '@lobechat/types';
import { isChunkableFile } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import pMap from 'p-map';

import { EmbeddingModel } from '@/database/models/embedding';
import { UserModel, UserNotFoundError } from '@/database/models/user';
import { chunks, fileChunks, files } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { keyVaults, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { ChunkService } from '@/server/services/chunk';
import {
  RagEmbeddingService,
  RagKeyVaultsUnreadableError,
  RagProviderNotConfiguredError,
  getRagFingerprint,
  getRagProviderStatus,
  getRagUserKeyVaults,
  mergeRagProviderUpdate,
  resolveRagEmbeddingConfig,
} from '@/server/services/rag';

const ragProviderProcedure = authedProcedure
  .use(serverDatabase)
  .use(keyVaults)
  .use(async (opts) => {
    const { ctx } = opts;
    return opts.next({
      ctx: {
        chunkService: new ChunkService(ctx.serverDB, ctx.userId),
        embeddingModel: new EmbeddingModel(ctx.serverDB, ctx.userId),
        userModel: new UserModel(ctx.serverDB, ctx.userId),
      },
    });
  });

const readKeyVaults = async (ctx: { serverDB: any; userId: string }) => {
  try {
    return (await getRagUserKeyVaults(ctx.serverDB, ctx.userId)) as Record<string, any>;
  } catch (error) {
    if (error instanceof UserNotFoundError) return {};
    if (error instanceof RagKeyVaultsUnreadableError) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message });
    }
    throw error;
  }
};

const saveKeyVaults = async (
  ctx: { serverDB: any; userId: string; userModel: UserModel },
  keyVaultsValue: Record<string, any>,
) => {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const encryptedKeyVaults = await gateKeeper.encrypt(JSON.stringify(keyVaultsValue));
  await ctx.userModel.updateSetting({ keyVaults: encryptedKeyVaults });
};

const hasReindexWork = async (ctx: { embeddingModel: EmbeddingModel }) =>
  (await ctx.embeddingModel.countChunkUsage()) > 0;

const reindexRequired = (
  previousFingerprint: string | undefined,
  nextFingerprint: string,
  hasExistingEmbeddings: boolean,
) => hasExistingEmbeddings && previousFingerprint !== nextFingerprint;

export const ragProviderRouter = router({
  clearUserOverride: ragProviderProcedure.mutation(async ({ ctx }) => {
    const previous = await resolveRagEmbeddingConfig(ctx.serverDB, ctx.userId);
    const keyVaultsValue = await readKeyVaults(ctx);
    delete keyVaultsValue.rag;
    await saveKeyVaults(ctx, keyVaultsValue);

    const next = await resolveRagEmbeddingConfig(ctx.serverDB, ctx.userId);
    return {
      reindexRequired:
        (await hasReindexWork(ctx)) &&
        !!previous.fingerprint &&
        !!next.fingerprint &&
        previous.fingerprint !== next.fingerprint,
      status: await getRagProviderStatus(ctx.serverDB, ctx.userId),
    };
  }),

  getStatus: ragProviderProcedure.query(async ({ ctx }) =>
    getRagProviderStatus(ctx.serverDB, ctx.userId),
  ),

  reindexAll: ragProviderProcedure.mutation(async ({ ctx }) => {
    const resolved = await resolveRagEmbeddingConfig(ctx.serverDB, ctx.userId);
    if (!resolved.config) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Configure a RAG embedding provider before reindexing.',
      });
    }

    const rows = await ctx.serverDB
      .selectDistinct({ fileType: files.fileType, id: files.id, name: files.name })
      .from(files)
      .innerJoin(
        fileChunks,
        and(eq(fileChunks.fileId, files.id), eq(fileChunks.userId, ctx.userId)),
      )
      .innerJoin(chunks, and(eq(chunks.id, fileChunks.chunkId), eq(chunks.userId, ctx.userId)))
      .where(eq(files.userId, ctx.userId));

    const taskIds = await pMap(
      rows.filter(({ fileType, name }) => isChunkableFile(name, fileType)),
      async ({ id }) => ctx.chunkService.asyncEmbeddingFileChunks(id, ctx.jwtPayload),
      { concurrency: 2 },
    );

    return { count: taskIds.filter(Boolean).length, taskIds: taskIds.filter(Boolean) };
  }),

  testConnection: ragProviderProcedure
    .input(RagProviderUpdateSchema.partial().optional())
    .mutation(async ({ ctx, input }) => {
      let config: RagProviderConfig | undefined;
      if (input) {
        const keyVaultsValue = await readKeyVaults(ctx);
        const current = keyVaultsValue.rag as RagProviderConfig | undefined;
        try {
          config = mergeRagProviderUpdate(current, {
            apiKey: input.apiKey,
            baseURL: input.baseURL,
            model: input.model || current?.model || '',
            provider: input.provider || current?.provider || 'openai',
          } as RagProviderUpdate);
        } catch (error) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: (error as Error).message });
        }
      } else {
        const resolved = await resolveRagEmbeddingConfig(ctx.serverDB, ctx.userId);
        config = resolved.config;
      }
      if (!config) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Configure a provider, model, and API key first.',
        });
      }

      try {
        await new RagEmbeddingService(config).testConnection();
      } catch (error) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (error as Error).message });
      }
      return { fingerprint: getRagFingerprint(config), success: true };
    }),

  update: ragProviderProcedure.input(RagProviderUpdateSchema).mutation(async ({ ctx, input }) => {
    const previous = await resolveRagEmbeddingConfig(ctx.serverDB, ctx.userId);
    const keyVaultsValue = await readKeyVaults(ctx);
    try {
      const current = keyVaultsValue.rag as RagProviderConfig | undefined;
      const next = mergeRagProviderUpdate(current, input);
      keyVaultsValue.rag = next;
      await saveKeyVaults(ctx, keyVaultsValue);

      const hasExistingEmbeddings = await hasReindexWork(ctx);
      return {
        reindexRequired: reindexRequired(
          previous.fingerprint,
          getRagFingerprint(next),
          hasExistingEmbeddings,
        ),
        status: await getRagProviderStatus(ctx.serverDB, ctx.userId),
      };
    } catch (error) {
      if (error instanceof RagProviderNotConfiguredError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      throw error;
    }
  }),
});

export type RagProviderRouter = typeof ragProviderRouter;
