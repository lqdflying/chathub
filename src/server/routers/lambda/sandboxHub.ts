import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { SandboxProfileModel } from '@/database/models/sandboxProfile';
import { SandboxProfileInstructionModel } from '@/database/models/sandboxProfileInstruction';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase, verifiedAccountScope } from '@/libs/trpc/lambda/middleware';
import {
  cancelSandboxJob,
  listSandboxHubJobs,
  listSandboxJobs,
  purgeSucceededSandboxJobs,
} from '@/server/services/sandbox/jobs/service';
import { hasSandboxHubAdmins, isSandboxHubAdmin } from '@/server/services/sandbox/profiles/admins';
import {
  getSandboxStartingInstruction,
  getUserSandboxProfiles,
} from '@/server/services/sandbox/profiles/catalog';
import {
  SandboxEnvError,
  deleteSandboxEnv,
  listSandboxEnvs,
  setSandboxEnv,
} from '@/server/services/sandbox/profiles/env';
import { findSandboxProfile } from '@/server/services/sandbox/profiles/hub';
import {
  SandboxHubProfileError,
  createSandboxHubProfile,
  deleteSandboxHubProfile,
  getSandboxHubSettings,
  moveSandboxHubProfile,
  prepareSandboxHubProfileImage,
  updateSandboxHubProfile,
} from '@/server/services/sandbox/profiles/hubAdmin';
import { getSandboxServerHealth } from '@/server/services/sandbox/profiles/status';
import {
  SANDBOX_ENV_VALUE_MAX_BYTES,
  SANDBOX_INSTRUCTION_MAX_BYTES,
  isValidSandboxProfileId,
} from '@/tools/sandbox/const';

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

const findProfileOrThrow = async (
  db: Parameters<typeof findSandboxProfile>[0],
  profileId: string,
) => {
  const profile = await findSandboxProfile(db, profileId);
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
      message: 'Only Sandbox Hub admins (SANDBOX_HUB_ADMINS) can change sandbox profiles',
    });
  }
};

const optionalText = (max: number) => z.string().max(max).nullish();
// Up to 30 days; the profiles-file rules check each field's own range.
const optionalMs = z
  .number()
  .int()
  .min(0)
  .max(30 * 24 * 3_600_000)
  .nullish();

const profileSettingsInput = z.object({
  avatar: optionalText(64 * 1024),
  cpu: optionalText(16),
  defaultEnabled: z.boolean(),
  description: z.string().max(280),
  egress: z.union([z.enum(['none', 'open']), z.array(z.string().max(253)).max(64)]).nullish(),
  image: optionalText(512),
  instructionBase: z.enum(['general', 'none']),
  instructionText: optionalText(4 * SANDBOX_INSTRUCTION_MAX_BYTES),
  jobMaxRuntimeMs: optionalMs,
  memory: optionalText(16),
  name: z.string().max(64),
  readyTimeoutMs: optionalMs,
  serverId: z.string().min(1).max(32),
  sessionIdleTimeoutMs: optionalMs,
  sessionMaxLifetimeMs: optionalMs,
});

/** Runs an admin change and returns the editor's data, mapping a rejection to its HTTP code. */
const adminChange = async (
  db: Parameters<typeof getSandboxHubSettings>[0],
  change: () => Promise<void>,
) => {
  try {
    await change();
  } catch (error) {
    if (error instanceof SandboxHubProfileError) {
      throw new TRPCError({ code: error.code, message: error.message });
    }
    throw error;
  }
  return getSandboxHubSettings(db);
};

// The service checks the name rules and the byte size; these only bound the request.
const envNameInput = z.string().min(1).max(64);
const envValueInput = z.string().min(1).max(SANDBOX_ENV_VALUE_MAX_BYTES);

/**
 * Writes or deletes one variable and returns what the user can see.
 * A sensitive value comes back as a hint. A value that is not sensitive
 * comes back in full. An error carries the refusal, never a stored value.
 */
const envChange = async (
  ctx: { serverDB: Parameters<typeof listSandboxEnvs>[0]; userId: string },
  profileId: string,
  change: () => Promise<void>,
) => {
  await findProfileOrThrow(ctx.serverDB, profileId);
  try {
    await change();
  } catch (error) {
    if (error instanceof SandboxEnvError) {
      throw new TRPCError({ code: error.code, message: error.message });
    }
    throw error;
  }
  return listSandboxEnvs(ctx.serverDB, ctx.userId);
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

  
  /** Admin only: adds a profile after the existing ones. */
createProfile: sandboxHubProcedure
    .input(accountScopeInput.extend({ id: profileIdInput, settings: profileSettingsInput }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      return adminChange(ctx.serverDB, () =>
        createSandboxHubProfile(ctx.serverDB, ctx.userId, input.id, input.settings),
      );
    }),

  
  
/** Removes one of this user's own variables for a profile. */
deleteMyEnv: sandboxHubProcedure
    .input(accountScopeInput.extend({ name: envNameInput, profileId: profileIdInput }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      return envChange(ctx, input.profileId, () =>
        deleteSandboxEnv({
          db: ctx.serverDB,
          name: input.name,
          owner: { userId: ctx.userId },
          profileId: input.profileId,
        }),
      );
    }),

  
  
/** Admin only: removes a profile, its instruction edit and every user's choice for it. */
deleteProfile: sandboxHubProcedure
    .input(accountScopeInput.extend({ id: profileIdInput }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      return adminChange(ctx.serverDB, () => deleteSandboxHubProfile(ctx.serverDB, input.id));
    }),

  
  
/** Admin only: removes a variable shared with every user of a profile. */
deleteSharedEnv: sandboxHubProcedure
    .input(accountScopeInput.extend({ name: envNameInput, profileId: profileIdInput }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      return envChange(ctx, input.profileId, () =>
        deleteSandboxEnv({
          db: ctx.serverDB,
          name: input.name,
          owner: { shared: true },
          profileId: input.profileId,
        }),
      );
    }),

  
  
/** Names and hints of the shared variables and this user's own, per profile; never values. */
listEnvs: sandboxHubProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return listSandboxEnvs(ctx.serverDB, ctx.userId);
  }),

  
  
/** Hub list: non-succeeded jobs, plus one page of succeeded jobs. */
listHubJobs: sandboxHubProcedure
    .input(accountScopeInput.extend({ page: z.number().int().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      return listSandboxHubJobs({ db: ctx.serverDB, page: input.page, userId: ctx.userId });
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

  
  
/** Admin only: moves a profile one place; order is tool and prompt order. */
moveProfile: sandboxHubProcedure
    .input(accountScopeInput.extend({ direction: z.enum(['down', 'up']), id: profileIdInput }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      return adminChange(ctx.serverDB, () =>
        moveSandboxHubProfile(ctx.serverDB, input.id, input.direction),
      );
    }),

  
  
/** Admin only: pulls a profile's image on its server ahead of users. */
prepareImage: sandboxHubProcedure
    .input(accountScopeInput.extend({ id: profileIdInput }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      return adminChange(ctx.serverDB, () => prepareSandboxHubProfileImage(ctx.serverDB, input.id));
    }),

  
  
/** Admin only: every profile's settings, the servers to pick from, and the inherited defaults. */
profileSettings: sandboxHubProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    await assertSandboxHubAdmin(ctx);
    return getSandboxHubSettings(ctx.serverDB);
  }),

  
  /** Deletes every succeeded background job for this user. */
purgeSucceededJobs: sandboxHubProcedure
    .input(accountScopeInput)
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      return purgeSucceededSandboxJobs({ db: ctx.serverDB, userId: ctx.userId });
    }),

  /** Admin only: drops the edited instruction so the starting text applies again. */
  resetInstruction: sandboxHubProcedure
    .input(accountScopeInput.extend({ profileId: profileIdInput }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      await findProfileOrThrow(ctx.serverDB, input.profileId);
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
      await findProfileOrThrow(ctx.serverDB, input.profileId);
      const starting = await getSandboxStartingInstruction(ctx.serverDB, input.profileId);
      const model = new SandboxProfileInstructionModel(ctx.serverDB);
      if (starting !== undefined && input.instruction === starting) {
        await model.delete(input.profileId);
      } else {
        await model.upsert(input.profileId, input.instruction, ctx.userId);
      }
      return getUserSandboxProfiles(ctx.serverDB, ctx.userId);
    }),

  /** Adds or replaces one of this user's own variables; it overrides a shared one of the same name. */
  setMyEnv: sandboxHubProcedure
    .input(
      accountScopeInput.extend({
        name: envNameInput,
        profileId: profileIdInput,
        sensitive: z.boolean().default(true),
        value: envValueInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      return envChange(ctx, input.profileId, () =>
        setSandboxEnv({
          db: ctx.serverDB,
          name: input.name,
          owner: { userId: ctx.userId },
          profileId: input.profileId,
          sensitive: input.sensitive,
          updatedBy: ctx.userId,
          value: input.value,
        }),
      );
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
      await findProfileOrThrow(ctx.serverDB, input.profileId);
      await new SandboxProfileModel(ctx.serverDB, ctx.userId).setEnabled(
        input.profileId,
        input.enabled,
      );
      return getUserSandboxProfiles(ctx.serverDB, ctx.userId);
    }),

  /** Admin only: adds or replaces a variable for every user of a profile. */
  setSharedEnv: sandboxHubProcedure
    .input(
      accountScopeInput.extend({
        name: envNameInput,
        profileId: profileIdInput,
        sensitive: z.boolean().default(true),
        value: envValueInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      return envChange(ctx, input.profileId, () =>
        setSandboxEnv({
          db: ctx.serverDB,
          name: input.name,
          owner: { shared: true },
          profileId: input.profileId,
          sensitive: input.sensitive,
          updatedBy: ctx.userId,
          value: input.value,
        }),
      );
    }),

  /** Admin only: replaces a profile's settings. */
  updateProfile: sandboxHubProcedure
    .input(accountScopeInput.extend({ id: profileIdInput, settings: profileSettingsInput }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      return adminChange(ctx.serverDB, () =>
        updateSandboxHubProfile(ctx.serverDB, ctx.userId, input.id, input.settings),
      );
    }),
});
