import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { GenerationTopicModel } from '@/database/models/generationTopic';
import { GenerationTopicItem } from '@/database/schemas/generation';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { GenerationService } from '@/server/services/generation';

const generationTopicProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      fileService: new FileService(ctx.serverDB, ctx.userId),
      generationService: new GenerationService(ctx.serverDB, ctx.userId),
      generationTopicModel: new GenerationTopicModel(ctx.serverDB, ctx.userId),
    },
  });
});

// Define input schemas
const updateTopicSchema = z.object({
  id: z.string(),
  value: z.object({
    coverUrl: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
  }),
});

const updateTopicCoverSchema = z.object({
  coverUrl: z.string(),
  id: z.string(),
});

const housekeepingInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ days: z.number().int().min(1).max(3650), mode: z.literal('olderThan') }),
]);

const deleteTopicResult = async (
  result: Awaited<ReturnType<GenerationTopicModel['delete']>>,
  fileService: FileService,
) => {
  if (!result) return;
  if (result.blockedByActiveTask) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Image topic has an active generation task',
    });
  }

  if (result.filesToDelete.length > 0) {
    try {
      await fileService.deleteFiles(result.filesToDelete);
    } catch (error) {
      console.error('Failed to delete files from S3:', error);
    }
  }

  return result.deletedTopic;
};

export const generationTopicRouter = router({
  createTopic: generationTopicProcedure.input(z.void()).mutation(async ({ ctx }) => {
    const data = await ctx.generationTopicModel.create('');
    return data.id;
  }),
  deleteTopic: generationTopicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.generationTopicModel.delete(input.id);
      return deleteTopicResult(result, ctx.fileService);
    }),
  getAllGenerationTopics: generationTopicProcedure.query(async ({ ctx }) => {
    return ctx.generationTopicModel.queryAll();
  }),
  housekeep: generationTopicProcedure
    .input(housekeepingInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.generationTopicModel.housekeep(input);

      if (result.filesToDelete.length > 0) {
        try {
          await ctx.fileService.deleteFiles(result.filesToDelete);
        } catch (error) {
          console.error('Failed to delete image history files from S3:', error);
        }
      }

      return {
        cutoffAt: result.cutoffAt,
        deletableTopicCount: result.deletableTopicCount,
        deletedTopicIds: result.deletedTopicIds,
        skippedActiveTopicCount: result.skippedActiveTopicCount,
      };
    }),
  previewHousekeeping: generationTopicProcedure
    .input(housekeepingInputSchema)
    .query(async ({ ctx, input }) => ctx.generationTopicModel.previewHousekeeping(input)),
  updateTopic: generationTopicProcedure
    .input(updateTopicSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.generationTopicModel.update(input.id, input.value as Partial<GenerationTopicItem>);
    }),
  updateTopicCover: generationTopicProcedure
    .input(updateTopicCoverSchema)
    .mutation(async ({ ctx, input }) => {
      // Process the cover image and get key
      const newCoverKey = await ctx.generationService.createCoverFromUrl(input.coverUrl);

      // Update the topic with the new cover key
      return ctx.generationTopicModel.update(input.id, { coverUrl: newCoverKey });
    }),
});

export type GenerationTopicRouter = typeof generationTopicRouter;

// Export input types for client/server service consistency
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;
export type UpdateTopicValue = UpdateTopicInput['value'];
export type UpdateTopicCoverInput = z.infer<typeof updateTopicCoverSchema>;
