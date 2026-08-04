import { z } from 'zod';

import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { insertKnowledgeBasesSchema } from '@/database/schemas';
import {
  describeKnowledgeDebugError,
  logKnowledgeDebugSafe,
  logKnowledgeDebugVerbose,
  runWithKnowledgeDebugOperation,
} from '@/libs/logger/knowledgeDebug';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KnowledgeBaseItem } from '@/types/knowledgeBase';

const knowledgeBaseProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      knowledgeBaseModel: new KnowledgeBaseModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const knowledgeBaseRouter = router({
  addFilesToKnowledgeBase: knowledgeBaseProcedure
    .input(z.object({ ids: z.array(z.string()), knowledgeBaseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return runWithKnowledgeDebugOperation(
        { operation: 'knowledge_association_add', runtime: 'lambda', transport: 'trpc' },
        async () => {
          const startedAt = Date.now();
          try {
            const result = await ctx.knowledgeBaseModel.addFilesToKnowledgeBase(
              input.knowledgeBaseId,
              input.ids,
            );
            logKnowledgeDebugSafe('knowledge_association_settled', {
              durationMs: Date.now() - startedAt,
              fileCount: input.ids.length,
              operation: 'add',
              outcome: 'completed',
              phase: 'knowledge_association',
            });
            logKnowledgeDebugVerbose('knowledge_association_settled', {
              fileIds: input.ids,
              knowledgeBaseId: input.knowledgeBaseId,
              operation: 'add',
            });
            return result;
          } catch (error) {
            logKnowledgeDebugSafe('knowledge_association_settled', {
              ...describeKnowledgeDebugError(error),
              durationMs: Date.now() - startedAt,
              fileCount: input.ids.length,
              operation: 'add',
              outcome: 'failed',
              phase: 'knowledge_association',
            });
            logKnowledgeDebugVerbose('knowledge_association_settled', {
              fileIds: input.ids,
              knowledgeBaseId: input.knowledgeBaseId,
              operation: 'add',
            });
            throw error;
          }
        },
      );
    }),

  createKnowledgeBase: knowledgeBaseProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().optional(),
        name: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.knowledgeBaseModel.create({
        avatar: input.avatar,
        description: input.description,
        name: input.name,
      });

      return data?.id;
    }),

  getKnowledgeBaseById: knowledgeBaseProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }): Promise<KnowledgeBaseItem | undefined> => {
      return ctx.knowledgeBaseModel.findById(input.id);
    }),

  getKnowledgeBases: knowledgeBaseProcedure.query(async ({ ctx }): Promise<KnowledgeBaseItem[]> => {
    return ctx.knowledgeBaseModel.query();
  }),

  removeAllKnowledgeBases: knowledgeBaseProcedure.mutation(async ({ ctx }) => {
    return ctx.knowledgeBaseModel.deleteAll();
  }),

  removeFilesFromKnowledgeBase: knowledgeBaseProcedure
    .input(z.object({ ids: z.array(z.string()), knowledgeBaseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return runWithKnowledgeDebugOperation(
        { operation: 'knowledge_association_remove', runtime: 'lambda', transport: 'trpc' },
        async () => {
          const startedAt = Date.now();
          try {
            const result = await ctx.knowledgeBaseModel.removeFilesFromKnowledgeBase(
              input.knowledgeBaseId,
              input.ids,
            );
            logKnowledgeDebugSafe('knowledge_association_settled', {
              durationMs: Date.now() - startedAt,
              fileCount: input.ids.length,
              operation: 'remove',
              outcome: 'completed',
              phase: 'knowledge_association',
            });
            logKnowledgeDebugVerbose('knowledge_association_settled', {
              fileIds: input.ids,
              knowledgeBaseId: input.knowledgeBaseId,
              operation: 'remove',
            });
            return result;
          } catch (error) {
            logKnowledgeDebugSafe('knowledge_association_settled', {
              ...describeKnowledgeDebugError(error),
              durationMs: Date.now() - startedAt,
              fileCount: input.ids.length,
              operation: 'remove',
              outcome: 'failed',
              phase: 'knowledge_association',
            });
            logKnowledgeDebugVerbose('knowledge_association_settled', {
              fileIds: input.ids,
              knowledgeBaseId: input.knowledgeBaseId,
              operation: 'remove',
            });
            throw error;
          }
        },
      );
    }),

  removeKnowledgeBase: knowledgeBaseProcedure
    .input(z.object({ id: z.string(), removeFiles: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.knowledgeBaseModel.delete(input.id);
    }),

  updateKnowledgeBase: knowledgeBaseProcedure
    .input(
      z.object({
        id: z.string(),
        value: insertKnowledgeBasesSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.knowledgeBaseModel.update(input.id, input.value);
    }),
});
