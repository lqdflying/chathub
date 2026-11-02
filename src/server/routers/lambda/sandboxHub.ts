import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { SandboxProfileModel } from '@/database/models/sandboxProfile';
import { SandboxProfileInstructionModel } from '@/database/models/sandboxProfileInstruction';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase, verifiedAccountScope } from '@/libs/trpc/lambda/middleware';
import {
  hasSandboxHubAdmins,
  isSandboxHubAdmin,
} from '@/server/services/sandbox/profiles/admins';
import { cancelSandboxJob, listSandboxJobs } from '@/server/services/sandbox/jobs/service';
import { getUserSandboxProfiles } from '@/server/services/sandbox/profiles/catalog';
import { findSandboxProfile } from '@/server/services/sandbox/profiles/load';
import { getSandboxServerHealth } from '@/server/services/sandbox/profiles/status';
import { SANDBOX_INSTRUCTION_MAX_BYTES, isValidSandboxProfileId } from '@/tools/sandbox/const';

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

const profileIdInput = z
  .string()
  .refine(isValidSandboxProfileId, { message: 'Invalid profile id' });

const instructionInput = z
  .string()
  .refine((value) => value.trim().length > 0, { message: 'Instruction is empty' })
  .refine((value) => Buffer.byteLength(value, 'utf8') <= SANDBOX_INSTRUCTION_MAX_BYTES, {
    message: `Instruction is larger than ${SANDBOX_INSTRUCTION_MAX_BYTES} bytes`,
  });

const findProfileOrThrow = (profileId: string) => {
  const profile = findSandboxProfile(profileId);
  if (!profile) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sandbox profile not found' });
  return profile;
};

const assertSandboxHubAdmin = async (ctx: {
  serverDB: Parameters<typeof isSandboxHubAdmin>[0];
  userId: string;
}) => {
  if (!(await isSandboxHubAdmin(ctx.serverDB, ctx.userId))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only Sandbox Hub admins (SANDBOX_HUB_ADMINS) can edit instructions',
    });
  }
};

export const sandboxHubRouter = router({
  /** What this user may change in the Hub beyond their own on/off choices. */
  access: sandboxHubProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return {
      adminsConfigured: hasSandboxHubAdmins(),
      canEditInstructions: await isSandboxHubAdmin(ctx.serverDB, ctx.userId),
    };
  }),

  /** Stops one of this user's running background jobs and returns the updated job list. */
  cancelJob: sandboxHubProcedure
    .input(accountScopeInput.extend({ jobId: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      const job = await cancelSandboxJob({
        db: ctx.serverDB,
        jobId: input.jobId,
        reason: 'Cancelled from Sandbox Hub.',
        userId: ctx.userId,
      });
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sandbox job not found' });
      return listSandboxJobs({ db: ctx.serverDB, userId: ctx.userId });
    }),

  /** This user's recent background jobs across conversations, newest first. */
  listJobs: sandboxHubProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return listSandboxJobs({ db: ctx.serverDB, userId: ctx.userId });
  }),

  /** Operator profiles merged with this user's Hub choices. */
  listProfiles: sandboxHubProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return getUserSandboxProfiles(ctx.serverDB, ctx.userId);
  }),

  /** Admin only: drops the edited instruction so the starting text applies again. */
  resetInstruction: sandboxHubProcedure
    .input(accountScopeInput.extend({ profileId: profileIdInput }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      findProfileOrThrow(input.profileId);
      await new SandboxProfileInstructionModel(ctx.serverDB).delete(input.profileId);
      return getUserSandboxProfiles(ctx.serverDB, ctx.userId);
    }),

  /** Health of the servers the profiles use, keyed by server id; cached 30 s. */
  serverStatus: sandboxHubProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return getSandboxServerHealth();
  }),

  /**
   * Admin only: replaces a profile's instruction for every user. Saving the
   * starting text again is the same as a reset, so it does not show as edited.
   */
  setInstruction: sandboxHubProcedure
    .input(accountScopeInput.extend({ instruction: instructionInput, profileId: profileIdInput }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      const profile = findProfileOrThrow(input.profileId);
      const model = new SandboxProfileInstructionModel(ctx.serverDB);
      if (input.instruction === profile.instruction) {
        await model.delete(input.profileId);
      } else {
        await model.upsert(input.profileId, input.instruction, ctx.userId);
      }
      return getUserSandboxProfiles(ctx.serverDB, ctx.userId);
    }),

  /**
   * Turns a profile on or off for this user. Off removes its tool and its
   * instruction from every agent at once, without editing agent plugins.
   */
  setProfileEnabled: sandboxHubProcedure
    .input(
      accountScopeInput.extend({
        enabled: z.boolean(),
        profileId: profileIdInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      findProfileOrThrow(input.profileId);
      await new SandboxProfileModel(ctx.serverDB, ctx.userId).setEnabled(
        input.profileId,
        input.enabled,
      );
      return getUserSandboxProfiles(ctx.serverDB, ctx.userId);
    }),
});
