import { ConversationGenerationEnqueueSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  GENERATION_DEBUG_CLIENT_EVENTS,
  isGenerationDebugEnabled,
  logGenerationDebugSafe,
} from '@/libs/logger/generationDebug';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { isDurableConversationGenerationEnabled } from '@/server/services/conversationGeneration/featureFlag';
import { ConversationGenerationService } from '@/server/services/conversationGeneration/service';

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

  /**
   * Receives sanitized CHATHUB_GENERATION_DEBUG events captured on the client
   * and re-emits them server-side so they reach the same Axiom stream as the
   * server events. Gated by the server env switch; client fields are treated
   * as untrusted and re-sanitized by the emitter before logging.
   */
  reportClientDebug: authedProcedure
    .input(
      z.object({
        events: z
          .array(
            z.object({
              event: z.enum(GENERATION_DEBUG_CLIENT_EVENTS),
              fields: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .min(1)
          .max(50),
      }),
    )
    .mutation(async ({ input }) => {
      if (!isGenerationDebugEnabled()) return { accepted: 0 };
      for (const { event, fields } of input.events) {
        logGenerationDebugSafe(event, { ...fields, side: 'client' });
      }
      return { accepted: input.events.length };
    }),
});
