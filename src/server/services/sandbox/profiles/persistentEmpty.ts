import type { LobeChatDatabase } from '@lobechat/database';

import { getSandboxProvider } from '../registry';
import { SandboxError } from '../types';
import { findSandboxProfile } from './hub';
import { findSandboxServer } from './load';
import { persistentMount } from './persistent';

/** Creating the throwaway sandbox, pulling its image if needed, and deleting the files. */
const EMPTY_BUDGET_MS = 5 * 60_000;

export type EmptyPersistentFolderResult =
  | {
      code: 'NOT_FOUND' | 'PRECONDITION_FAILED' | 'INTERNAL_SERVER_ERROR';
      message: string;
      ok: false;
    }
  | { ok: true };

/**
 * Empties this user's persistent folder for one profile. Only the user's own
 * volume is reachable: its name comes from the profile id and this user id.
 */
export const emptySandboxPersistentFolder = async (
  db: LobeChatDatabase,
  userId: string,
  profileId: string,
): Promise<EmptyPersistentFolderResult> => {
  const profile = await findSandboxProfile(db, profileId);
  if (!profile) return { code: 'NOT_FOUND', message: 'Sandbox profile not found', ok: false };
  const mount = persistentMount(profile, userId);
  if (!mount) {
    return {
      code: 'PRECONDITION_FAILED',
      message: 'This sandbox has no persistent folder.',
      ok: false,
    };
  }
  const server = findSandboxServer(profile.serverId);
  if (!server || server.status !== 'ok') {
    return {
      code: 'PRECONDITION_FAILED',
      message: `The "${profile.serverId}" sandbox server is not configured on this server.`,
      ok: false,
    };
  }
  const provider = getSandboxProvider(profile, server);
  if (!provider.emptyPersistentFolder) {
    return {
      code: 'PRECONDITION_FAILED',
      message: 'This sandbox server cannot empty folders.',
      ok: false,
    };
  }
  try {
    await provider.emptyPersistentFolder(mount, AbortSignal.timeout(EMPTY_BUDGET_MS));
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof SandboxError || error instanceof Error
        ? error.message
        : 'The persistent folder could not be emptied.';
    return { code: 'INTERNAL_SERVER_ERROR', message, ok: false };
  }
};
