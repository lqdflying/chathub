import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { isProviderUsageProvider } from '@/const/providerUsage';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase, verifiedAccountScope } from '@/libs/trpc/lambda/middleware';
import { ProviderUsageService } from '@/server/services/providerUsage';

const providerUsageProcedure = authedProcedure
  .use(verifiedAccountScope)
  .use(serverDatabase)
  .use(async (opts) => {
    const { ctx } = opts;
    if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' });

    return opts.next({
      ctx: {
        providerUsageService: new ProviderUsageService(ctx.serverDB, ctx.userId),
      },
    });
  });

const assertRequestedAccountScope = (requestedScope: string, verifiedScope?: string) => {
  if (!verifiedScope || requestedScope !== verifiedScope) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Account scope does not match the authenticated user',
    });
  }
};

const providerInput = z.object({
  accountScope: z.string().min(1),
  provider: z
    .string()
    .min(1)
    .refine((provider) => isProviderUsageProvider(provider), {
      message: 'Provider does not support usage checks',
    }),
});

export const providerUsageRouter = router({
  get: providerUsageProcedure.input(providerInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return (await ctx.providerUsageService.getUsage(input.provider)) ?? null;
  }),

  /** Bypasses the short server cache, e.g. after the user changed the key. */
  refresh: providerUsageProcedure.input(providerInput).mutation(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return (await ctx.providerUsageService.getUsage(input.provider, { force: true })) ?? null;
  }),
});
