import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase, verifiedAccountScope } from '@/libs/trpc/lambda/middleware';
import { OpenAICodexOAuthService } from '@/server/services/openaiCodex/oauth';

const openaiCodexProcedure = authedProcedure
  .use(verifiedAccountScope)
  .use(serverDatabase)
  .use(async (opts) => {
    const { ctx } = opts;

    return opts.next({
      ctx: {
        openaiCodexOAuthService: new OpenAICodexOAuthService(ctx.serverDB),
      },
    });
  });

const accountScopeInput = z.object({
  accountScope: z.string().min(1),
});

const assertRequestedAccountScope = (requestedScope: string, verifiedScope?: string) => {
  if (!verifiedScope || requestedScope !== verifiedScope) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Account scope does not match the authenticated user',
    });
  }
};

export const openaiCodexRouter = router({
  logout: openaiCodexProcedure.input(accountScopeInput).mutation(async ({ ctx, input }) => {
    if (!ctx.userId) throw new Error('User not authenticated');
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    await ctx.openaiCodexOAuthService.logout(ctx.userId);
    return { success: true };
  }),

  pollDeviceLogin: openaiCodexProcedure
    .input(accountScopeInput.extend({ handoffId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.userId) throw new Error('User not authenticated');
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      return ctx.openaiCodexOAuthService.pollDeviceLogin(ctx.userId, input.handoffId);
    }),

  startDeviceLogin: openaiCodexProcedure.input(accountScopeInput).mutation(async ({ ctx, input }) => {
    if (!ctx.userId) throw new Error('User not authenticated');
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return ctx.openaiCodexOAuthService.startDeviceLogin(ctx.userId);
  }),

  status: openaiCodexProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    if (!ctx.userId) throw new Error('User not authenticated');
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return ctx.openaiCodexOAuthService.getStatus(ctx.userId);
  }),
});
