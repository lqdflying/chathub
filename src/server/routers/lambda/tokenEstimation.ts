import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { TokenEstimationService } from '@/server/services/tokenEstimation';

const tokenEstimationProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      tokenEstimationService: new TokenEstimationService(ctx.serverDB, ctx.userId),
    },
  });
});

const identity = z.object({
  model: z.string().min(1).max(200),
  provider: z.string().min(1).max(64),
});

export const tokenEstimationRouter = router({
  getMultiplier: tokenEstimationProcedure.input(identity).query(async ({ ctx, input }) => ({
    multiplier: await ctx.tokenEstimationService.getMultiplier(input.provider, input.model),
  })),

  observe: tokenEstimationProcedure
    .input(
      identity.extend({
        actualInputTokens: z.number().positive().finite(),
        eligible: z.boolean(),
        uncalibratedInputTokens: z.number().positive().finite(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.tokenEstimationService.observe(input);
    }),
});
