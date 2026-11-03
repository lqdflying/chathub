import type { LobeChatDatabase } from '@lobechat/database';
import type { SandboxHubJobList, SandboxJobItem, SandboxToolResult } from '@lobechat/types';

import { SandboxJobModel } from '@/database/models/sandboxJob';
import type { SandboxJobRow } from '@/database/schemas';

import {
  SANDBOX_HUB_JOB_PAGE_SIZE,
  SANDBOX_JOB_LIST_LIMIT,
  SANDBOX_JOB_UNREACHABLE_MS,
} from './constants';
import { checkSandboxJob, markSandboxJobLost, toJobItem, toJobResult } from './lifecycle';

interface JobLookup {
  db: LobeChatDatabase;
  jobId: string;
  userId: string;
}

/**
 * The saved result of an ended job, or a live check of a running one. A
 * check that finds the command ended saves the result, so it is kept even if
 * the watcher is late or not running. Undefined when the job is not this
 * user's.
 */
export const getSandboxJobResult = async ({
  db,
  jobId,
  userId,
}: JobLookup): Promise<SandboxToolResult | undefined> => {
  const row = await new SandboxJobModel(db, userId).find(jobId);
  if (!row) return undefined;
  if (row.status !== 'running') return toJobResult(row);
  const checked = await checkSandboxJob({
    apiName: 'getJobResult',
    db,
    row,
    userId,
    withLog: true,
  });
  return toJobResult(checked.row, { log: checked.log });
};

/** Stops a running job and saves what it produced so far. An ended job is returned as is. */
export const cancelSandboxJob = async ({
  db,
  jobId,
  reason,
  userId,
}: JobLookup & { reason: string }): Promise<SandboxJobRow | undefined> => {
  const row = await new SandboxJobModel(db, userId).find(jobId);
  if (!row || row.status !== 'running') return row;
  const checked = await checkSandboxJob({
    apiName: 'cancelJob',
    db,
    row,
    stopReason: reason,
    userId,
  });
  return checked.row;
};

/** One conversation sandbox's jobs, or with no key all of the user's jobs; newest first. */
export const listSandboxJobs = async ({
  db,
  sessionKey,
  userId,
}: {
  db: LobeChatDatabase;
  sessionKey?: string;
  userId: string;
}): Promise<SandboxJobItem[]> => {
  const model = new SandboxJobModel(db, userId);
  const rows = sessionKey
    ? await model.listBySession(sessionKey, SANDBOX_JOB_LIST_LIMIT)
    : await model.listRecent(SANDBOX_JOB_LIST_LIMIT);
  return rows.map(toJobItem);
};

/** Hub list: every non-succeeded job, plus one page of succeeded jobs. */
export const listSandboxHubJobs = async ({
  db,
  page = 1,
  userId,
}: {
  db: LobeChatDatabase;
  page?: number;
  userId: string;
}): Promise<SandboxHubJobList> => {
  const model = new SandboxJobModel(db, userId);
  const pageSize = SANDBOX_HUB_JOB_PAGE_SIZE;
  const requested = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const total = await model.countSucceeded();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(requested, pages);
  const [other, succeeded] = await Promise.all([
    model.listOther(),
    model.listSucceeded(pageSize, (current - 1) * pageSize),
  ]);
  return {
    other: other.map(toJobItem),
    succeeded: {
      items: succeeded.map(toJobItem),
      page: current,
      pageSize,
      total,
    },
  };
};

/** Deletes every succeeded job for this user. */
export const purgeSucceededSandboxJobs = async ({
  db,
  userId,
}: {
  db: LobeChatDatabase;
  userId: string;
}): Promise<{ deleted: number }> => ({
  deleted: await new SandboxJobModel(db, userId).deleteSucceeded(),
});

/**
 * The watcher's check. A failure to reach the sandbox server is retried on
 * the next poll; after SANDBOX_JOB_UNREACHABLE_MS without contact the job is
 * given up as lost.
 */
export const watchSandboxJob = async ({
  db,
  now = Date.now(),
  row,
  userId,
}: {
  db: LobeChatDatabase;
  now?: number;
  row: SandboxJobRow;
  userId: string;
}): Promise<SandboxJobRow> => {
  try {
    const checked = await checkSandboxJob({ apiName: 'watchJob', db, now, row, userId });
    return checked.row;
  } catch (error) {
    const lastContact = (row.lastCheckedAt ?? row.startedAt).getTime();
    if (now - lastContact >= SANDBOX_JOB_UNREACHABLE_MS) {
      return markSandboxJobLost(
        db,
        userId,
        row,
        `The sandbox server could not be reached for ${Math.round(SANDBOX_JOB_UNREACHABLE_MS / 60_000)} minutes.`,
      );
    }
    console.warn('[sandbox] background job check failed; retrying on the next poll', {
      errorClass: error instanceof Error ? error.name : typeof error,
    });
    return row;
  }
};
