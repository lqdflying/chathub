import type { LobeChatDatabase } from '@lobechat/database';
import type { SandboxProfileItem } from '@lobechat/types';

import { SandboxProfileModel } from '@/database/models/sandboxProfile';
import {
  type SavedSandboxInstruction,
  SandboxProfileInstructionModel,
} from '@/database/models/sandboxProfileInstruction';
import { createSandboxProfileManifest } from '@/tools/sandbox';
import { parseSandboxToolIdentifier } from '@/tools/sandbox/const';

import { findSandboxServer, getSandboxProfileCatalog, isSandboxProfileUsable } from './load';
import type { ResolvedSandboxProfile, ResolvedSandboxServer } from './schema';

const MISSING_CHOICES_TABLE = /relation "user_sandbox_profiles" does not exist/i;
const MISSING_INSTRUCTIONS_TABLE = /relation "sandbox_profile_instructions" does not exist/i;

/** Postgres `undefined_table`, including when Drizzle wraps the driver error. */
const isMissingTable = (error: unknown, pattern: RegExp) => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const record = current as { cause?: unknown; code?: unknown; message?: unknown };
    if (record.code === '42P01') return true;
    if (typeof record.message === 'string' && pattern.test(record.message)) {
      return true;
    }
    current = record.cause;
  }
  return false;
};

const isMissingSandboxChoicesTable = (error: unknown) =>
  isMissingTable(error, MISSING_CHOICES_TABLE);

/**
 * Hub choices. A missing table (the migration has not run) falls back to each
 * profile's `defaultEnabled`. Any other read error is rethrown so a saved off
 * switch is not treated as still on.
 */
const readChoices = async (db: LobeChatDatabase, userId: string) => {
  try {
    return await new SandboxProfileModel(db, userId).list();
  } catch (error) {
    if (!isMissingSandboxChoicesTable(error)) throw error;
    console.warn('[sandbox] could not read Sandbox Hub choices; using profile defaults', {
      errorClass: error instanceof Error ? error.name : typeof error,
    });
    return new Map<string, boolean>();
  }
};

/**
 * Admin-edited instructions, shared by every user. A missing table (the
 * migration has not run) means none were edited. Any other read error is
 * rethrown so an edited instruction is never silently swapped for the
 * starting text.
 */
const readInstructions = async (db: LobeChatDatabase) => {
  try {
    return await new SandboxProfileInstructionModel(db).list();
  } catch (error) {
    if (!isMissingTable(error, MISSING_INSTRUCTIONS_TABLE)) throw error;
    return new Map<string, SavedSandboxInstruction>();
  }
};

export const toSandboxProfileItem = (
  profile: ResolvedSandboxProfile,
  enabled: boolean,
  saved?: SavedSandboxInstruction,
): SandboxProfileItem => {
  const server = findSandboxServer(profile.serverId);
  return {
    available: isSandboxProfileUsable(profile),
    avatar: profile.avatar,
    cpu: profile.cpu,
    defaultEnabled: profile.defaultEnabled,
    description: profile.description,
    egress: profile.egress,
    enabled,
    id: profile.id,
    identifier: profile.identifier,
    instruction: saved?.instruction ?? profile.instruction,
    instructionCustomized: !!saved,
    ...(saved ? { instructionUpdatedAt: saved.updatedAt.toISOString() } : {}),
    memory: profile.memory,
    name: profile.name,
    serverId: profile.serverId,
    serverName: server?.name ?? profile.serverId,
    sessionIdleTimeoutMs: profile.sessionIdleTimeoutMs,
    sessionMaxLifetimeMs: profile.sessionMaxLifetimeMs,
  };
};

/** Every operator profile, merged with this user's Hub choices, in config order. */
export const getUserSandboxProfiles = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<SandboxProfileItem[]> => {
  const { profiles } = getSandboxProfileCatalog();
  if (profiles.length === 0) return [];
  const [choices, instructions] = await Promise.all([
    readChoices(db, userId),
    readInstructions(db),
  ]);
  return profiles.map((profile) =>
    toSandboxProfileItem(
      profile,
      choices.get(profile.id) ?? profile.defaultEnabled,
      instructions.get(profile.id),
    ),
  );
};

/** Profiles the user can put in front of the model: enabled in the Hub and runnable. */
export const getUserEnabledSandboxProfiles = async (db: LobeChatDatabase, userId: string) => {
  const profiles = await getUserSandboxProfiles(db, userId);
  return profiles.filter((profile) => profile.enabled && profile.available);
};

/** One tool manifest per profile the user turned on, in config order. */
export const getUserSandboxManifests = async (db: LobeChatDatabase, userId: string) => {
  const profiles = await getUserEnabledSandboxProfiles(db, userId);
  return profiles.map(createSandboxProfileManifest);
};

export type SandboxProfileResolution =
  | { message: string; ok: false; reason: 'disabled' | 'not_configured' | 'unknown' }
  | { ok: true; profile: ResolvedSandboxProfile; server: ResolvedSandboxServer };

/**
 * The single gate for running a Sandbox tool call, shared by the browser
 * route and the durable worker. A profile left in an agent's plugins, a
 * stale tab, or a made-up tool name cannot run a profile that is turned off,
 * unconfigured, or missing its server key.
 */
export const resolveSandboxProfileForUser = async ({
  db,
  identifier,
  userId,
}: {
  db: LobeChatDatabase;
  identifier: string;
  userId: string;
}): Promise<SandboxProfileResolution> => {
  const parsed = parseSandboxToolIdentifier(identifier);
  if (!parsed) {
    return { message: `Unknown Sandbox tool "${identifier}".`, ok: false, reason: 'unknown' };
  }

  const { profiles } = getSandboxProfileCatalog();
  const profile = profiles.find((item) => item.id === parsed.profileId);
  if (!profile) {
    return {
      message:
        profiles.length === 0
          ? 'Sandbox is not configured: set OPENSANDBOX_SERVER_URL and OPENSANDBOX_IMAGE, or a Sandbox Hub profile with a server and image.'
          : `The "${parsed.profileId}" sandbox is not configured on this server.`,
      ok: false,
      reason: 'not_configured',
    };
  }

  const server = findSandboxServer(profile.serverId);
  if (!server || server.status !== 'ok') {
    return {
      message: `The "${profile.name}" sandbox cannot run: its server "${profile.serverId}" is missing its API key.`,
      ok: false,
      reason: 'not_configured',
    };
  }

  let enabled = profile.defaultEnabled;
  try {
    enabled = (await new SandboxProfileModel(db, userId).find(profile.id)) ?? enabled;
  } catch (error) {
    if (!isMissingSandboxChoicesTable(error)) {
      return {
        message: `The "${profile.name}" sandbox cannot run because Sandbox Hub choices could not be read.`,
        ok: false,
        reason: 'not_configured',
      };
    }
  }
  if (!enabled) {
    return {
      message: `The "${profile.name}" sandbox is turned off in Sandbox Hub. Turn it on there to use it.`,
      ok: false,
      reason: 'disabled',
    };
  }

  return { ok: true, profile, server };
};
