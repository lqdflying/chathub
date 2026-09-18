import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { OpenAICodexOAuthService } from '@/server/services/openaiCodex/oauth';

const openaiCodexProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      openaiCodexOAuthService: new OpenAICodexOAuthService(ctx.serverDB),
    },
  });
});

export const openaiCodexRouter = router({
  logout: openaiCodexProcedure.mutation(async ({ ctx }) => {
    if (!ctx.userId) throw new Error('User not authenticated');
    await ctx.openaiCodexOAuthService.logout(ctx.userId);
    return { success: true };
  }),

  pollDeviceLogin: openaiCodexProcedure
    .input(z.object({ handoffId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.userId) throw new Error('User not authenticated');
      return ctx.openaiCodexOAuthService.pollDeviceLogin(ctx.userId, input.handoffId);
    }),

  startDeviceLogin: openaiCodexProcedure.mutation(async ({ ctx }) => {
    if (!ctx.userId) throw new Error('User not authenticated');
    return ctx.openaiCodexOAuthService.startDeviceLogin(ctx.userId);
  }),

  status: openaiCodexProcedure.query(async ({ ctx }) => {
    if (!ctx.userId) throw new Error('User not authenticated');
    return ctx.openaiCodexOAuthService.getStatus(ctx.userId);
  }),
});
