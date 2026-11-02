import type { LobeChatDatabase } from '@lobechat/database';

import { SandboxHubProfileModel } from '@/database/models/sandboxHubProfile';
import type { SandboxHubProfileRow } from '@/database/schemas';
import { DEFAULT_SANDBOX_PROFILE_ID } from '@/tools/sandbox/const';

import {
  type SandboxProfilesEnv,
  getSandboxFileCatalog,
  readSandboxProfilesEnv,
  resolveProfileConfig,
} from './load';
import { isMissingTable } from './missingTable';
import {
  type ResolvedSandboxProfile,
  SANDBOX_INSTRUCTION_MAX_BYTES,
  type SandboxProfileCatalog,
  type SandboxProfileConfig,
  type SandboxProfileSeed,
  sandboxProfileConfigSchema,
} from './schema';

const MISSING_HUB_TABLE = /relation "sandbox_hub_profiles" does not exist/i;

/** The settings columns of a Hub profile row, every one present (null = inherit). */
export type SandboxHubProfileFields = Pick<
  SandboxHubProfileRow,
  | 'avatar'
  | 'cpu'
  | 'defaultEnabled'
  | 'description'
  | 'egress'
  | 'id'
  | 'image'
  | 'instructionBase'
  | 'instructionText'
  | 'jobMaxRuntimeMs'
  | 'memory'
  | 'name'
  | 'readyTimeoutMs'
  | 'serverId'
  | 'sessionIdleTimeoutMs'
  | 'sessionMaxLifetimeMs'
>;

type HubRowFields = SandboxHubProfileFields;

/** A file (or OPENSANDBOX_*) profile as a Hub row; unset fields stay null and keep inheriting. */
export const seedToHubSettings = ({
  config,
  text,
}: SandboxProfileSeed): SandboxHubProfileFields => ({
  avatar: config.avatar ?? null,
  cpu: config.cpu ?? null,
  defaultEnabled: config.defaultEnabled ?? config.id === DEFAULT_SANDBOX_PROFILE_ID,
  description: config.description,
  egress: config.egress ?? null,
  id: config.id,
  image: config.image ?? null,
  instructionBase: config.instruction?.base ?? 'general',
  instructionText: text ?? config.instruction?.text ?? null,
  jobMaxRuntimeMs: config.jobMaxRuntimeMs ?? null,
  memory: config.memory ?? null,
  name: config.name,
  readyTimeoutMs: config.readyTimeoutMs ?? null,
  serverId: config.server,
  sessionIdleTimeoutMs: config.sessionIdleTimeoutMs ?? null,
  sessionMaxLifetimeMs: config.sessionMaxLifetimeMs ?? null,
});

/** A stored setting that is set (not null, which means "inherit"). */
const isSet = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined;

const formatIssues = (issues: { message: string; path: (number | string)[] }[]) =>
  issues.map((issue) => `${issue.path.join('.') || 'profile'}: ${issue.message}`).join('; ');

/**
 * A Hub row as a profiles-file config, checked with the same schema the file
 * uses, so the Hub and the file accept exactly the same profiles.
 */
export const hubFieldsToConfig = (
  row: HubRowFields,
): { error: string; ok: false } | { config: SandboxProfileConfig; ok: true } => {
  const text = row.instructionText ?? undefined;
  if (text && Buffer.byteLength(text, 'utf8') > SANDBOX_INSTRUCTION_MAX_BYTES) {
    return { error: `instruction: larger than ${SANDBOX_INSTRUCTION_MAX_BYTES} bytes`, ok: false };
  }
  const parsed = sandboxProfileConfigSchema.safeParse({
    ...(row.avatar ? { avatar: row.avatar } : {}),
    ...(row.cpu ? { cpu: row.cpu } : {}),
    defaultEnabled: row.defaultEnabled,
    description: row.description,
    ...(isSet(row.egress) ? { egress: row.egress } : {}),
    id: row.id,
    ...(row.image ? { image: row.image } : {}),
    instruction: { base: row.instructionBase, ...(text ? { text } : {}) },
    ...(isSet(row.jobMaxRuntimeMs) ? { jobMaxRuntimeMs: row.jobMaxRuntimeMs } : {}),
    ...(row.memory ? { memory: row.memory } : {}),
    name: row.name,
    ...(isSet(row.readyTimeoutMs) ? { readyTimeoutMs: row.readyTimeoutMs } : {}),
    server: row.serverId,
    ...(isSet(row.sessionIdleTimeoutMs) ? { sessionIdleTimeoutMs: row.sessionIdleTimeoutMs } : {}),
    ...(isSet(row.sessionMaxLifetimeMs) ? { sessionMaxLifetimeMs: row.sessionMaxLifetimeMs } : {}),
  });
  if (!parsed.success) return { error: formatIssues(parsed.error.issues), ok: false };
  return { config: parsed.data, ok: true };
};

/** Applies the OPENSANDBOX_* defaults to a Hub row. */
export const resolveHubRow = (
  row: HubRowFields,
  env: SandboxProfilesEnv = readSandboxProfilesEnv(),
): { error: string; ok: false } | { ok: true; profile: ResolvedSandboxProfile } => {
  const converted = hubFieldsToConfig(row);
  if (!converted.ok) return converted;
  return resolveProfileConfig(converted.config, env, row.instructionText ?? undefined);
};

let warnedIgnoredFileProfiles = false;

/**
 * Hub rows in order. While the Hub has none, the file's (or OPENSANDBOX_*)
 * profiles are imported; several server processes doing this at once insert
 * each profile once. Once the Hub has rows, file profiles are ignored.
 */
const readHubRows = async (db: LobeChatDatabase, file: SandboxProfileCatalog) => {
  const model = new SandboxHubProfileModel(db);
  const rows = await model.list();
  if (rows.length > 0) {
    if (file.source === 'file' && file.seeds.length > 0 && !warnedIgnoredFileProfiles) {
      warnedIgnoredFileProfiles = true;
      console.warn(
        '[sandbox] SANDBOX_PROFILES_FILE lists profiles, but Sandbox Hub manages them; the file profiles are ignored. Keep only servers in the file.',
      );
    }
    return rows;
  }
  if (file.seeds.length === 0) return rows;

  const added = await model.seed(file.seeds.map(seedToHubSettings));
  if (added > 0) {
    console.info('[sandbox] imported sandbox profiles into Sandbox Hub', {
      count: added,
      source: file.source,
    });
  }
  return model.list();
};

/**
 * The sandbox profiles in use: Sandbox Hub rows resolved against the file's
 * servers and the OPENSANDBOX_* defaults. A row that no longer resolves (no
 * image known) is left out here; admins still see and fix it in the Hub. A
 * profile whose server is gone resolves but is not usable. While the Hub
 * table does not exist (migration not run), the file catalog applies.
 */
export const getSandboxProfileCatalog = async (
  db: LobeChatDatabase,
): Promise<SandboxProfileCatalog> => {
  const file = getSandboxFileCatalog();
  let rows;
  try {
    rows = await readHubRows(db, file);
  } catch (error) {
    if (!isMissingTable(error, MISSING_HUB_TABLE)) throw error;
    return file;
  }
  const env = readSandboxProfilesEnv();
  const profiles: ResolvedSandboxProfile[] = [];
  for (const row of rows) {
    const resolved = resolveHubRow(row, env);
    if (resolved.ok) profiles.push(resolved.profile);
  }
  return { ...file, profiles, source: 'hub' };
};

export const findSandboxProfile = async (db: LobeChatDatabase, profileId: string) => {
  const { profiles } = await getSandboxProfileCatalog(db);
  return profiles.find((profile) => profile.id === profileId);
};

/** Test hook. */
export const resetSandboxHubWarnings = () => {
  warnedIgnoredFileProfiles = false;
};
