import type { LobeChatDatabase } from '@lobechat/database';
import type { SandboxImageStatus } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import type { Task } from 'graphile-worker';

import { getServerDB } from '@/database/core/db-adaptor';
import { SandboxHubProfileModel } from '@/database/models/sandboxHubProfile';
import type { SandboxHubProfileRow } from '@/database/schemas';

import { getSandboxProvider } from '../registry';
import { resolveHubRow } from './hub';
import { findSandboxServer } from './load';

export const SANDBOX_IMAGE_PREPARE_TASK = 'sandbox_image_prepare';

/** Longest a preparation waits for the server to pull the image and start it. */
export const SANDBOX_IMAGE_PREPARE_TIMEOUT_MS = 15 * 60_000;

const MAX_MESSAGE_CHARS = 500;

const clip = (message: string) =>
  message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS)}…` : message;

const parseCheckedAt = (value: unknown): Date | undefined => {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/**
 * Pulls one Hub profile's image on its server ahead of users and records the
 * result on the profile row, for the image it was run with. When
 * `expectedCheckedAt` is set, the result is written only if that preparing
 * run is still current, so a slower older pull cannot overwrite a newer one.
 * A profile whose image changes meanwhile shows `unknown`, since the status
 * names the old image (`imageCheckedRef`).
 */
export const prepareSandboxProfileImage = async (
  db: LobeChatDatabase,
  profileId: string,
  timeoutMs = SANDBOX_IMAGE_PREPARE_TIMEOUT_MS,
  expectedCheckedAt?: Date,
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
  try {
    const { durationMs } = await provider.prepareImage(AbortSignal.timeout(timeoutMs));
    return record('ready', `Ready after ${Math.max(1, Math.round(durationMs / 1000))} s.`);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return fail(
      timedOut
        ? `The image did not start within ${Math.round(timeoutMs / 60_000)} minutes.`
        : error instanceof Error
          ? error.message
          : String(error),
    );
  }
};

/**
 * Marks a profile as preparing and runs the preparation on the durable
 * worker, in this process when the worker is disabled, or in this process
 * when no worker job can be queued.
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

  const runHere = () => {
    void prepareSandboxProfileImage(db, row.id, undefined, checkedAt).catch((error) => {
      console.warn('[sandbox] image preparation failed', {
        errorClass: error instanceof Error ? error.name : typeof error,
      });
    });
  };

  // The worker is not running in this process, so a queued job would sit
  // until it is shown as unfinished. Do not import the worker module: it
  // imports this file, and its start check is also false in tests.
  if (process.env.DISABLE_CONVERSATION_WORKER === '1') {
    runHere();
    return;
  }

  try {
    await db.execute(sql`
      SELECT graphile_worker.add_job(
        ${SANDBOX_IMAGE_PREPARE_TASK},
        ${JSON.stringify({ checkedAt: checkedAt.toISOString(), profileId: row.id })}::json,
        job_key := ${`sandbox-image:${row.id}`},
        max_attempts := 1
      )
    `);
  } catch {
    runHere();
  }
};

/** Durable-worker task for `startSandboxImagePreparation`. */
export const handleSandboxImagePrepare: Task = async (payload) => {
  const body = (payload || {}) as { checkedAt?: unknown; profileId?: unknown };
  if (typeof body.profileId !== 'string') return;
  // A present but unreadable token must not fall through to an unconditional write.
  if (body.checkedAt !== undefined && !parseCheckedAt(body.checkedAt)) return;
  const db = await getServerDB();
  await prepareSandboxProfileImage(db, body.profileId, undefined, parseCheckedAt(body.checkedAt));
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
