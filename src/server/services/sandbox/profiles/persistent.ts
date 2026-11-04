import { createHash } from 'node:crypto';

import type { SandboxVolumeSpec } from '../providers/opensandbox/provider';
import type { ResolvedSandboxProfile } from './schema';

/**
 * Name of one user's persistent folder volume for one profile: `chathub-`
 * and 40 hex characters of a hash of the profile id and user id. Stable,
 * free of raw ids, and a valid OpenSandbox `claimName` (DNS label).
 */
export const persistentVolumeName = (profileId: string, userId: string) =>
  `chathub-${createHash('sha256')
    .update(JSON.stringify(['persist', profileId, userId]))
    .digest('hex')
    .slice(0, 40)}`;

/** The mount a user's sandbox of this profile gets, or undefined without a persistent folder. */
export const persistentMount = (
  profile: Pick<ResolvedSandboxProfile, 'id' | 'persistentFolder'>,
  userId: string,
) =>
  profile.persistentFolder
    ? { claimName: persistentVolumeName(profile.id, userId), mountPath: profile.persistentFolder }
    : undefined;

/**
 * The provider's volume option for a tool call: the mount and its label
 * value, or no mount (so a reused sandbox that has one is replaced).
 */
export const persistentVolumeSpec = (
  profile: Pick<ResolvedSandboxProfile, 'id' | 'persistentFolder'>,
  userId: string,
): SandboxVolumeSpec => {
  const mount = persistentMount(profile, userId);
  if (!mount) return {};
  return {
    fingerprint: createHash('sha256')
      .update(JSON.stringify([mount.claimName, mount.mountPath]))
      .digest('hex')
      .slice(0, 16),
    mount,
  };
};
