import type { LobeChatDatabase } from '@lobechat/database';
import { sql } from 'drizzle-orm';

import { SANDBOX_JOB_WATCH_MAX_ATTEMPTS, SANDBOX_JOB_WATCH_TASK } from './constants';

export interface SandboxJobWatchPayload {
  jobId: string;
  userId: string;
}

/**
 * Queues the next check of a job on the durable worker. One key per job: a
 * check queued while another is waiting replaces it, and one queued from the
 * running check starts a new chain link (Graphile clears the key of a
 * running job in `replace` mode).
 */
export const enqueueSandboxJobWatch = async (
  db: LobeChatDatabase,
  payload: SandboxJobWatchPayload,
  runAt: Date,
) => {
  await db.execute(sql`
    SELECT graphile_worker.add_job(
      ${SANDBOX_JOB_WATCH_TASK},
      ${JSON.stringify(payload)}::json,
      run_at := ${runAt.toISOString()}::timestamptz,
      job_key := ${`sandbox-job:${payload.jobId}`},
      max_attempts := ${SANDBOX_JOB_WATCH_MAX_ATTEMPTS}
    )
  `);
};
