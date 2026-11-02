import type { LobeChatDatabase } from '@lobechat/database';
import type { SandboxImageStatus } from '@lobechat/types';

import { SandboxHubProfileModel } from '@/database/models/sandboxHubProfile';
import type { SandboxHubProfileRow } from '@/database/schemas';

import { getSandboxProvider } from '../registry';
import { resolveHubRow } from './hub';
import { findSandboxServer } from './load';

/** Longest a preparation waits for the server to pull the image and start it. */
export const SANDBOX_IMAGE_PREPARE_TIMEOUT_MS = 15 * 60_000;

const MAX_MESSAGE_CHARS = 500;

const clip = (message: string) =>
  message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS)}…` : message;

/**
 * Pulls one Hub profile's image on its server ahead of users and records the
 * result on the profile row, for the image it was run with. The result is
 * written only if `expectedCheckedAt` is still the current preparing run, so
 * a slower older pull cannot overwrite a newer one. A profile whose image
 * changes meanwhile shows `unknown`, since the status names the old image
 * (`imageCheckedRef`).
 */
export const prepareSandboxProfileImage = async (
  db: LobeChatDatabase,
  profileId: string,
  timeoutMs = SANDBOX_IMAGE_PREPARE_TIMEOUT_MS,
  expectedCheckedAt: Date,
): Promise<SandboxImageStatus | undefined> => {
  const model = new SandboxHubProfileModel(db);
  const row = await model.find(profileId);
  if (!row) return undefined;

  const resolved = resolveHubRow(row);
  const ref = resolved.ok ? resolved.profile.image : (row.image ?? '');
  const record = async (
    status: 'failed' | 'ready',
    message: string,
  ): Promise<SandboxImageStatus | undefined> => {
    const written = await model.setImageStatus(
      profileId,
      { message: clip(message), ref, status },
      expectedCheckedAt,
    );
    return written ? status : undefined;
  };
  const fail = (message: string) => record('failed', message);
  if (!resolved.ok) return fail(resolved.error);

  const { profile } = resolved;
  const server = findSandboxServer(profile.serverId);
  if (!server) return fail(`Server "${profile.serverId}" is not configured on this server.`);
  if (server.status !== 'ok') return fail(`Server "${profile.serverId}" is missing its API key.`);

  const provider = getSandboxProvider(profile, server);
  if (!provider.prepareImage) return fail('This sandbox server cannot prepare images.');
  // The wait spends most of its time in a timer sleep. AbortSignal.timeout
  // rejects that sleep as AbortError, and a fetch as TimeoutError. The signal
  // is what both have in common.
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const { durationMs } = await provider.prepareImage(signal);
    return record('ready', `Ready after ${Math.max(1, Math.round(durationMs / 1000))} s.`);
  } catch (error) {
    return fail(
      signal.aborted
        ? `The image did not start within ${Math.round(timeoutMs / 60_000)} minutes.`
        : error instanceof Error
          ? error.message
          : String(error),
    );
  }
};

/**
 * Marks a profile as preparing and pulls its image in this process. It does
 * not use the conversation worker: a pull can take 15 minutes and would hold
 * one of that worker's slots the whole time.
 */
export const startSandboxImagePreparation = async (
  db: LobeChatDatabase,
  row: Pick<SandboxHubProfileRow, 'id' | 'image'>,
  imageRef: string,
) => {
  const checkedAt = await new SandboxHubProfileModel(db).setImageStatus(row.id, {
    ref: imageRef,
    status: 'preparing',
  });
  if (!checkedAt) return;

  void prepareSandboxProfileImage(db, row.id, undefined, checkedAt).catch((error) => {
    console.warn('[sandbox] image preparation failed', {
      errorClass: error instanceof Error ? error.name : typeof error,
    });
  });
};

/**
 * The status to show for a profile's current image: a result for another
 * image is `unknown`, and a preparation that outlived its time limit (the
 * process stopped) is `failed`.
 */
export const effectiveImageStatus = (
  row: Pick<
    SandboxHubProfileRow,
    'imageCheckedAt' | 'imageCheckedRef' | 'imageStatus' | 'imageStatusMessage'
  >,
  currentImage: string | undefined,
  now = Date.now(),
): { message?: string; status: SandboxImageStatus; updatedAt?: string } => {
  if (row.imageStatus === 'unknown' || !currentImage || row.imageCheckedRef !== currentImage) {
    return { status: 'unknown' };
  }
  const updatedAt = row.imageCheckedAt?.toISOString();
  if (
    row.imageStatus === 'preparing' &&
    row.imageCheckedAt &&
    now - row.imageCheckedAt.getTime() > SANDBOX_IMAGE_PREPARE_TIMEOUT_MS + 5 * 60_000
  ) {
    return { message: 'The preparation did not finish.', status: 'failed', updatedAt };
  }
  return {
    ...(row.imageStatusMessage ? { message: row.imageStatusMessage } : {}),
    status: row.imageStatus,
    ...(updatedAt ? { updatedAt } : {}),
  };
};
