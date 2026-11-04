import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { SandboxProfileModel } from '@/database/models/sandboxProfile';
import { SandboxProfileInstructionModel } from '@/database/models/sandboxProfileInstruction';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase, verifiedAccountScope } from '@/libs/trpc/lambda/middleware';
import {
  cancelSandboxJob,
  listSandboxHubJobs,
  purgeFinishedSandboxJobs,
} from '@/server/services/sandbox/jobs/service';
import { hasSandboxHubAdmins, isSandboxHubAdmin } from '@/server/services/sandbox/profiles/admins';
import { getUserSandboxProfiles } from '@/server/services/sandbox/profiles/catalog';
import {
  SandboxEnvError,
  deleteSandboxEnv,
  listSandboxEnvs,
  setSandboxEnv,
} from '@/server/services/sandbox/profiles/env';
import {
  SandboxFileError,
  deleteSandboxFile,
  listSandboxFiles,
  setSandboxFile,
} from '@/server/services/sandbox/profiles/files';
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
  SANDBOX_FILE_MAX_BYTES,
  SANDBOX_FILE_PATH_MAX_LENGTH,
  SANDBOX_INSTRUCTION_MAX_BYTES,
  SANDBOX_SHARED_INSTRUCTION_ID,
  isValidSandboxProfileId,
} from '@/tools/sandbox/const';
import { SANDBOX_SHARED_INSTRUCTION } from '@/tools/sandbox/systemRole';

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
  persistentFolder: optionalText(255),
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

// The service checks the path, mode and size rules; these only bound the request.
const filePathInput = z.string().min(1).max(SANDBOX_FILE_PATH_MAX_LENGTH);
const fileModeInput = z.string().min(1).max(4);
// Base64 of the largest file, with padding.
const fileContentInput = z
  .string()
  .min(1)
  .max(Math.ceil(SANDBOX_FILE_MAX_BYTES / 3) * 4);

/**
 * Writes or deletes one file and returns what the user can see. A sensitive
 * file never comes back; one that is not sensitive comes back as text. An
 * error carries the refusal, never stored content.
 */
const fileChange = async (
  ctx: { serverDB: Parameters<typeof listSandboxFiles>[0]; userId: string },
  profileId: string,
  change: (profile: { persistentFolder?: string }) => Promise<void>,
) => {
  const profile = await findProfileOrThrow(ctx.serverDB, profileId);
  try {
    await change(profile);
  } catch (error) {
    if (error instanceof SandboxFileError) {
      throw new TRPCError({ code: error.code, message: error.message });
    }
    throw error;
  }
  return listSandboxFiles(ctx.serverDB, ctx.userId);
};

const setFileInput = accountScopeInput.extend({
  content: fileContentInput.optional(),
  mode: fileModeInput,
  path: filePathInput,
  profileId: profileIdInput,
  sensitive: z.boolean().default(true),
});

export const sandboxHubRouter = router({
  /** What this user may change in the Hub beyond their own on/off choices. */
  access: sandboxHubProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return {
      adminsConfigured: hasSandboxHubAdmins(),
      canEditInstructions: await isSandboxHubAdmin(ctx.serverDB, ctx.userId),
    };
  }),

  /** Stops one of this user's running background jobs. */
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

  /** Removes one of this user's own files for a profile. */
  deleteMyFile: sandboxHubProcedure
    .input(accountScopeInput.extend({ path: filePathInput, profileId: profileIdInput }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      return fileChange(ctx, input.profileId, () =>
        deleteSandboxFile({
          db: ctx.serverDB,
          owner: { userId: ctx.userId },
          path: input.path,
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

  /** Admin only: removes a file shared with every user of a profile. */
  deleteSharedFile: sandboxHubProcedure
    .input(accountScopeInput.extend({ path: filePathInput, profileId: profileIdInput }))
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      return fileChange(ctx, input.profileId, () =>
        deleteSandboxFile({
          db: ctx.serverDB,
          owner: { shared: true },
          path: input.path,
          profileId: input.profileId,
        }),
      );
    }),

  /** Shared variables and this user's own. A value is included only when it is not sensitive. */
  listEnvs: sandboxHubProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return listSandboxEnvs(ctx.serverDB, ctx.userId);
  }),

  /** Shared files and this user's own, per profile. Content only for files that are not sensitive. */
  listFiles: sandboxHubProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return listSandboxFiles(ctx.serverDB, ctx.userId);
  }),

  /** Hub list: running jobs, plus one page of finished jobs. */
  listHubJobs: sandboxHubProcedure
    .input(accountScopeInput.extend({ page: z.number().int().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      return listSandboxHubJobs({ db: ctx.serverDB, page: input.page, userId: ctx.userId });
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

  /** Deletes every finished background job for this user. Running jobs stay. */
  purgeFinishedJobs: sandboxHubProcedure
    .input(accountScopeInput)
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      return purgeFinishedSandboxJobs({ db: ctx.serverDB, userId: ctx.userId });
    }),

  /** Admin only: drops a saved General instruction so the built-in text applies again. */
  resetInstruction: sandboxHubProcedure
    .input(
      accountScopeInput.extend({
        profileId: z.literal(SANDBOX_SHARED_INSTRUCTION_ID),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      await new SandboxProfileInstructionModel(ctx.serverDB).delete(input.profileId);
      return getUserSandboxProfiles(ctx.serverDB, ctx.userId);
    }),

  /** Health of the servers the profiles use, keyed by server id; cached 30 s. */
  serverStatus: sandboxHubProcedure.input(accountScopeInput).query(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return getSandboxServerHealth();
  }),

  /**
   * Admin only: replaces the General instruction. Saving the built-in text
   * again deletes the row, so it does not show as edited.
   */
  setInstruction: sandboxHubProcedure
    .input(
      accountScopeInput.extend({
        instruction: instructionInput,
        profileId: z.literal(SANDBOX_SHARED_INSTRUCTION_ID),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
      await assertSandboxHubAdmin(ctx);
      const model = new SandboxProfileInstructionModel(ctx.serverDB);
      if (input.instruction === SANDBOX_SHARED_INSTRUCTION) {
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
   * Adds or replaces one of this user's own files; it replaces a shared file
   * at the same path. Without content, only the mode and Sensitive change.
   */
  setMyFile: sandboxHubProcedure.input(setFileInput).mutation(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    return fileChange(ctx, input.profileId, (profile) =>
      setSandboxFile({
        content: input.content,
        db: ctx.serverDB,
        mode: input.mode,
        owner: { userId: ctx.userId },
        path: input.path,
        persistentFolder: profile.persistentFolder,
        profileId: input.profileId,
        sensitive: input.sensitive,
        updatedBy: ctx.userId,
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

  /** Admin only: adds or replaces a file for every user of a profile. */
  setSharedFile: sandboxHubProcedure.input(setFileInput).mutation(async ({ ctx, input }) => {
    assertRequestedAccountScope(input.accountScope, ctx.verifiedAccountScope);
    await assertSandboxHubAdmin(ctx);
    return fileChange(ctx, input.profileId, (profile) =>
      setSandboxFile({
        content: input.content,
        db: ctx.serverDB,
        mode: input.mode,
        owner: { shared: true },
        path: input.path,
        persistentFolder: profile.persistentFolder,
        profileId: input.profileId,
        sensitive: input.sensitive,
        updatedBy: ctx.userId,
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
