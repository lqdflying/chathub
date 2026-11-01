import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { SandboxProfileModel } from '@/database/models/sandboxProfile';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase, verifiedAccountScope } from '@/libs/trpc/lambda/middleware';
import { getUserSandboxProfiles } from '@/server/services/sandbox/profiles/catalog';
import { findSandboxProfile } from '@/server/services/sandbox/profiles/load';
import { getSandboxServerHealth } from '@/server/services/sandbox/profiles/status';
import { isValidSandboxProfileId } from '@/tools/sandbox/const';

const sandboxHubProcedure = authedProcedure
  .use(verifiedAccountScope)
  .use(serverDatabase)
  .use(async (opts) => {
    if (!opts.ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' });
    return opts.next({ ctx: { userId: opts.ctx.userId } });
  });

const assertRequestedAccountScope = (requestedScope: string, verifiedScope?: string) => {
  if (!verifiedScope || requestedScope !== verifiedScope) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Account scope does not match the authenticated user',
    });
  }
};

const accountScopeInput = z.object({ accountScope: z.string().min(1) });

export const sandboxHubRouter = router({
  /** Operator profiles merged with this user's Hub choices. */
  listProfiles: sandboxHubProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return getUserSandboxProfiles(ctx.serverDB, ctx.userId);
  }),

  /** Health of the servers the profiles use, keyed by server id; cached 30 s. */
  serverStatus: sandboxHubProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return getSandboxServerHealth();
  }),

  /**
   * Turns a profile on or off for this user. Off removes its tool and its
   * instruction from every agent at once, without editing agent plugins.
   */
  setProfileEnabled: sandboxHubProcedure
    .input(
      accountScopeInput.extend({
        enabled: z.boolean(),
        profileId: z.string().refine(isValidSandboxProfileId, { message: 'Invalid profile id' }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      if (!findSandboxProfile(input.profileId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sandbox profile not found' });
      }
      await new SandboxProfileModel(ctx.serverDB, ctx.userId).setEnabled(
        input.profileId,
        input.enabled,
      );
      return getUserSandboxProfiles(ctx.serverDB, ctx.userId);
    }),
});
