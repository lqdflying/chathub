import { ConversationGenerationEnqueueSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ConversationGenerationService } from '@/server/services/conversationGeneration/service';
import { isDurableConversationGenerationEnabled } from '@/server/services/conversationGeneration/featureFlag';

const conversationGenerationProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      conversationGenerationService: new ConversationGenerationService(ctx.serverDB, ctx.userId),
    },
  });
});

const assertEnabled = async (userId: string) => {
  if (!(await isDurableConversationGenerationEnabled(userId))) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Durable conversation generation is disabled.',
    });
  }
};

export const conversationGenerationRouter = router({
  cancel: conversationGenerationProcedure
    .input(z.object({ operationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertEnabled(ctx.userId);
      return ctx.conversationGenerationService.cancel(input.operationId);
    }),

  enqueue: conversationGenerationProcedure
    .input(ConversationGenerationEnqueueSchema)
    .mutation(async ({ ctx, input }) => {
      await assertEnabled(ctx.userId);
      return ctx.conversationGenerationService.enqueue(input);
    }),

  getOperation: conversationGenerationProcedure
    .input(z.object({ operationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertEnabled(ctx.userId);
      return ctx.conversationGenerationService.getOperation(input.operationId);
    }),

  getOperationByIdempotencyKey: conversationGenerationProcedure
    .input(z.object({ idempotencyKey: z.string().min(8).max(180) }))
    .query(async ({ ctx, input }) => {
      await assertEnabled(ctx.userId);
      return ctx.conversationGenerationService.getOperationByIdempotencyKey(input.idempotencyKey);
    }),

  listActive: conversationGenerationProcedure.query(async ({ ctx }) => {
    await assertEnabled(ctx.userId);
    return ctx.conversationGenerationService.listActive();
  }),

  listEvents: conversationGenerationProcedure
    .input(z.object({ cursor: z.number().int().min(0).optional() }).optional())
    .query(async ({ ctx, input }) => {
      await assertEnabled(ctx.userId);
      return ctx.conversationGenerationService.listEvents(input?.cursor ?? 0);
    }),
});
