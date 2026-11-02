import type { Task } from 'graphile-worker';

import { getServerDB } from '@/database/core/db-adaptor';
import { SandboxJobModel } from '@/database/models/sandboxJob';

import { SANDBOX_JOB_POLL_MS } from './constants';
import { type SandboxJobWatchPayload, enqueueSandboxJobWatch } from './enqueue';
import { watchSandboxJob } from './service';

/**
 * Durable-worker task: checks one running job, which also renews its
 * sandbox, then queues the next check until the job ends. A thrown error
 * (the database is down) lets Graphile retry this run.
 */
export const handleSandboxJobWatch: Task = async (payload) => {
  const { jobId, userId } = (payload || {}) as Partial<SandboxJobWatchPayload>;
  if (typeof jobId !== 'string' || typeof userId !== 'string') return;

  const db = await getServerDB();
  const row = await new SandboxJobModel(db, userId).find(jobId);
  if (!row || row.status !== 'running') return;

  const next = await watchSandboxJob({ db, row, userId });
  if (next.status === 'running') {
    await enqueueSandboxJobWatch(db, { jobId, userId }, new Date(Date.now() + SANDBOX_JOB_POLL_MS));
  }
};
