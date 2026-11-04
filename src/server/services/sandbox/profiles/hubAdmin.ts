import type { LobeChatDatabase } from '@lobechat/database';
import type {
  SandboxHubProfileSettingsInput,
  SandboxHubProfileSettingsItem,
  SandboxHubSettings,
} from '@lobechat/types';

import { SandboxHubProfileModel } from '@/database/models/sandboxHubProfile';
import { SandboxProfileInstructionModel } from '@/database/models/sandboxProfileInstruction';
import type { SandboxHubProfileRow } from '@/database/schemas';
import { DEFAULT_SANDBOX_PROFILE_ID, SANDBOX_SHARED_INSTRUCTION_ID } from '@/tools/sandbox/const';
import { SANDBOX_SHARED_INSTRUCTION } from '@/tools/sandbox/systemRole';

import {
  type SandboxHubProfileFields,
  getSandboxProfileCatalog,
  hubFieldsToConfig,
  resolveHubRow,
} from './hub';
import {
  DEFAULT_SANDBOX_JOB_MAX_RUNTIME_MS,
  envEgress,
  findSandboxServer,
  getSandboxFileCatalog,
  readSandboxProfilesEnv,
} from './load';
import { effectiveImageStatus, startSandboxImagePreparation } from './prepare';
import { SANDBOX_PROFILES_MAX } from './schema';

export type SandboxHubProfileErrorCode = 'BAD_REQUEST' | 'CONFLICT' | 'NOT_FOUND';

/** A rejected admin change, with a message for the admin. */
export class SandboxHubProfileError extends Error {
  readonly code: SandboxHubProfileErrorCode;

  constructor(code: SandboxHubProfileErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'SandboxHubProfileError';
  }
}

const text = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** A bare number is GiB (the form says so); a value with a unit is kept. */
const memory = (value?: string | null) => {
  const trimmed = text(value);
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const gib = Number(trimmed);
  return Number.isInteger(gib) ? `${gib}Gi` : `${Math.round(gib * 1024)}Mi`;
};
const number = (value?: number | null) =>
  value === null || value === undefined || !Number.isFinite(value) ? null : Math.round(value);

/** Admin input as Hub row fields; blank settings become null and inherit. */
export const toHubFields = (
  id: string,
  input: SandboxHubProfileSettingsInput,
): SandboxHubProfileFields => ({
  avatar: text(input.avatar),
  cpu: text(input.cpu),
  defaultEnabled: input.defaultEnabled,
  description: input.description.trim(),
  egress: input.egress ?? null,
  id,
  image: text(input.image),
  instructionBase: input.instructionBase,
  // Kept as written: whitespace can matter in an instruction.
  instructionText: input.instructionText?.trim() ? input.instructionText : null,
  jobMaxRuntimeMs: number(input.jobMaxRuntimeMs),
  memory: memory(input.memory),
  name: input.name.trim(),
  readyTimeoutMs: number(input.readyTimeoutMs),
  serverId: input.serverId.trim(),
  sessionIdleTimeoutMs: number(input.sessionIdleTimeoutMs),
  sessionMaxLifetimeMs: number(input.sessionMaxLifetimeMs),
});

/** Why a profile cannot be offered to users, or undefined when it can. */
const profileIssue = (fields: SandboxHubProfileFields) => {
  const converted = hubFieldsToConfig(fields);
  if (!converted.ok) return converted.error;
  const server = findSandboxServer(fields.serverId);
  if (!server) return `Server "${fields.serverId}" is not in SANDBOX_PROFILES_FILE.`;
  const resolved = resolveHubRow(fields);
  if (!resolved.ok) return `image: ${resolved.error}`;
  if (server.status !== 'ok') return `Server "${fields.serverId}" is missing its API key.`;
  return undefined;
};

/** Rejects settings the profiles file would reject, an unknown server, or no image. */
const assertValid = (fields: SandboxHubProfileFields) => {
  const converted = hubFieldsToConfig(fields);
  if (!converted.ok) throw new SandboxHubProfileError('BAD_REQUEST', converted.error);
  if (!findSandboxServer(fields.serverId)) {
    throw new SandboxHubProfileError(
      'BAD_REQUEST',
      `Server "${fields.serverId}" is not in SANDBOX_PROFILES_FILE.`,
    );
  }
  const resolved = resolveHubRow(fields);
  if (!resolved.ok) {
    throw new SandboxHubProfileError('BAD_REQUEST', 'Set an image: OPENSANDBOX_IMAGE is unset.');
  }
};

const toSettingsItem = (
  row: SandboxHubProfileRow,
  deletable: boolean,
): SandboxHubProfileSettingsItem => {
  const resolved = resolveHubRow(row);
  const image = effectiveImageStatus(row, resolved.ok ? resolved.profile.image : undefined);
  const issue = profileIssue(row);
  return {
    avatar: row.avatar,
    cpu: row.cpu,
    defaultEnabled: row.defaultEnabled,
    deletable,
    description: row.description,
    egress: row.egress,
    id: row.id,
    image: row.image,
    imageStatus: image.status,
    ...(image.message ? { imageStatusMessage: image.message } : {}),
    ...(image.updatedAt ? { imageStatusUpdatedAt: image.updatedAt } : {}),
    instructionBase: row.instructionBase,
    instructionText: row.instructionText,
    ...(issue ? { issue } : {}),
    jobMaxRuntimeMs: row.jobMaxRuntimeMs,
    memory: row.memory,
    name: row.name,
    readyTimeoutMs: row.readyTimeoutMs,
    serverId: row.serverId,
    sessionIdleTimeoutMs: row.sessionIdleTimeoutMs,
    sessionMaxLifetimeMs: row.sessionMaxLifetimeMs,
    updatedAt: row.updatedAt.toISOString(),
  };
};

const canDelete = (row: { id: string }, total: number) =>
  row.id !== DEFAULT_SANDBOX_PROFILE_ID && total > 1;

/** The Hub admin editor's data. Imports the file's profiles on first use. */
export const getSandboxHubSettings = async (db: LobeChatDatabase): Promise<SandboxHubSettings> => {
  await getSandboxProfileCatalog(db);
  const rows = await new SandboxHubProfileModel(db).list();
  const saved = await new SandboxProfileInstructionModel(db).list();
  const shared = saved.get(SANDBOX_SHARED_INSTRUCTION_ID);
  const env = readSandboxProfilesEnv();
  return {
    generalInstruction: shared?.instruction ?? SANDBOX_SHARED_INSTRUCTION,
    generalInstructionCustomized: !!shared,
    ...(shared ? { generalInstructionUpdatedAt: shared.updatedAt.toISOString() } : {}),
    defaults: {
      cpu: env.OPENSANDBOX_CPU,
      egress: envEgress(env),
      ...(env.OPENSANDBOX_IMAGE?.trim() ? { image: env.OPENSANDBOX_IMAGE.trim() } : {}),
      jobMaxRuntimeMs: env.SANDBOX_JOB_MAX_RUNTIME ?? DEFAULT_SANDBOX_JOB_MAX_RUNTIME_MS,
      memory: env.OPENSANDBOX_MEMORY,
      readyTimeoutMs: env.OPENSANDBOX_READY_TIMEOUT,
      sessionIdleTimeoutMs: env.OPENSANDBOX_SESSION_IDLE_TIMEOUT,
      sessionMaxLifetimeMs: env.OPENSANDBOX_SESSION_MAX_LIFETIME,
    },
    maxProfiles: SANDBOX_PROFILES_MAX,
    profiles: rows.map((row) => toSettingsItem(row, canDelete(row, rows.length))),
    servers: getSandboxFileCatalog().servers.map(({ id, name, status }) => ({ id, name, status })),
  };
};

export const createSandboxHubProfile = async (
  db: LobeChatDatabase,
  userId: string,
  id: string,
  input: SandboxHubProfileSettingsInput,
) => {
  const fields = toHubFields(id, input);
  assertValid(fields);
  const model = new SandboxHubProfileModel(db);
  if (await model.find(id)) {
    throw new SandboxHubProfileError('CONFLICT', `A profile with id "${id}" already exists.`);
  }
  if ((await model.count()) >= SANDBOX_PROFILES_MAX) {
    throw new SandboxHubProfileError(
      'BAD_REQUEST',
      `Sandbox Hub holds at most ${SANDBOX_PROFILES_MAX} profiles.`,
    );
  }
  await model.create(fields, userId);
};

export const updateSandboxHubProfile = async (
  db: LobeChatDatabase,
  userId: string,
  id: string,
  input: SandboxHubProfileSettingsInput,
) => {
  const fields = toHubFields(id, input);
  assertValid(fields);
  const { id: profileId, ...settings } = fields;
  const updated = await new SandboxHubProfileModel(db).update(profileId, settings, userId);
  if (!updated) throw new SandboxHubProfileError('NOT_FOUND', 'Sandbox profile not found.');
};

/**
 * Removes a profile with its instruction edit and every user's on/off
 * choice, in one transaction. `general` stays (agents use lobe-sandbox),
 * and so does the last profile, so an empty Hub never re-imports the file's
 * profiles.
 */
export const deleteSandboxHubProfile = async (db: LobeChatDatabase, id: string) => {
  const model = new SandboxHubProfileModel(db);
  if (!(await model.find(id))) {
    throw new SandboxHubProfileError('NOT_FOUND', 'Sandbox profile not found.');
  }
  if (id === DEFAULT_SANDBOX_PROFILE_ID) {
    throw new SandboxHubProfileError(
      'BAD_REQUEST',
      'The general profile cannot be deleted; agents use it as lobe-sandbox. Turn it off by default instead.',
    );
  }
  if ((await model.count()) <= 1) {
    throw new SandboxHubProfileError('BAD_REQUEST', 'The last profile cannot be deleted.');
  }
  await model.deleteWithRelated(id);
};

export const moveSandboxHubProfile = async (
  db: LobeChatDatabase,
  id: string,
  direction: 'down' | 'up',
) => {
  const model = new SandboxHubProfileModel(db);
  if (!(await model.find(id))) {
    throw new SandboxHubProfileError('NOT_FOUND', 'Sandbox profile not found.');
  }
  await model.move(id, direction);
};

/** Starts pulling a profile's current image on its server. */
export const prepareSandboxHubProfileImage = async (db: LobeChatDatabase, id: string) => {
  const row = await new SandboxHubProfileModel(db).find(id);
  if (!row) throw new SandboxHubProfileError('NOT_FOUND', 'Sandbox profile not found.');
  const resolved = resolveHubRow(row);
  if (!resolved.ok) {
    throw new SandboxHubProfileError('BAD_REQUEST', 'Set an image: OPENSANDBOX_IMAGE is unset.');
  }
  await startSandboxImagePreparation(db, row, resolved.profile.image);
};
