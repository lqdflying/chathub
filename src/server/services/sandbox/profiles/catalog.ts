import type { LobeChatDatabase } from '@lobechat/database';
import type { SandboxProfileItem } from '@lobechat/types';

import { SandboxProfileModel } from '@/database/models/sandboxProfile';
import { createSandboxProfileManifest } from '@/tools/sandbox';
import { parseSandboxToolIdentifier } from '@/tools/sandbox/const';

import { findSandboxServer, getSandboxProfileCatalog, isSandboxProfileUsable } from './load';
import type { ResolvedSandboxProfile, ResolvedSandboxServer } from './schema';

/**
 * Hub choices, or none when the table cannot be read (for example before the
 * migration ran). Profiles then fall back to their `defaultEnabled`.
 */
const readChoices = async (db: LobeChatDatabase, userId: string) => {
  try {
    return await new SandboxProfileModel(db, userId).list();
  } catch (error) {
    console.warn('[sandbox] could not read Sandbox Hub choices; using profile defaults', {
      errorClass: error instanceof Error ? error.name : typeof error,
    });
    return new Map<string, boolean>();
  }
};

export const toSandboxProfileItem = (
  profile: ResolvedSandboxProfile,
  enabled: boolean,
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
    instruction: profile.instruction,
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
  const choices = await readChoices(db, userId);
  return profiles.map((profile) =>
    toSandboxProfileItem(profile, choices.get(profile.id) ?? profile.defaultEnabled),
  );
};

/** Profiles the user can put in front of the model: enabled in the Hub and runnable. */
export const getUserEnabledSandboxProfiles = async (db: LobeChatDatabase, userId: string) =>
  (await getUserSandboxProfiles(db, userId)).filter(
    (profile) => profile.enabled && profile.available,
  );

/** One tool manifest per profile the user turned on, in config order. */
export const getUserSandboxManifests = async (db: LobeChatDatabase, userId: string) =>
  (await getUserEnabledSandboxProfiles(db, userId)).map(createSandboxProfileManifest);

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
  } catch {
    // Same fallback as the Hub list: an unreadable table means profile defaults.
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
