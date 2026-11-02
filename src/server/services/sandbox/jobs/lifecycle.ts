import type { LobeChatDatabase } from '@lobechat/database';
import type {
  SandboxJobFile,
  SandboxJobItem,
  SandboxJobStatus,
  SandboxToolResult,
} from '@lobechat/types';
import { posix } from 'node:path';

import { type FinishSandboxJobInput, SandboxJobModel } from '@/database/models/sandboxJob';
import type { SandboxJobRow } from '@/database/schemas';
import { sandboxEnv } from '@/envs/sandbox';
import { SANDBOX_CONTROL_DIR, sandboxToolIdentifier } from '@/tools/sandbox/const';

import { persistSandboxOutputFiles } from '../conversationFiles';
import { loadSandboxFiles } from '../exportFiles';
import { resolveSandboxProfileForUser } from '../profiles/catalog';
import { findSandboxProfile, findSandboxServer } from '../profiles/load';
import { getSandboxProvider } from '../registry';
import { SandboxError, SandboxRequestError, type SandboxWorkspace } from '../types';
import { SANDBOX_JOB_CHECK_BUDGET_MS } from './constants';

type Ending = Pick<FinishSandboxJobInput, 'error' | 'exitCode' | 'status'>;

export const SANDBOX_GONE_MESSAGE =
  "The job's sandbox is gone: it was removed or replaced (an image or network change, or the server's sandbox age limit) before the job ended.";
const COMMAND_GONE_MESSAGE =
  "The job's command is no longer known to its sandbox, which was probably replaced.";

const OUTPUT_LIST_DEPTH = 5;

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/** First line of a command, for lists. */
export const summarizeCommand = (command: string, max = 200) => {
  const lines = command.trim().split('\n');
  const first = lines[0] ?? '';
  if (first.length > max) return `${first.slice(0, max - 1)}…`;
  return lines.length > 1 ? `${first} …` : first;
};

export const toJobItem = (row: SandboxJobRow): SandboxJobItem => ({
  command: summarizeCommand(row.command),
  ...(row.exitCode === null ? {} : { exitCode: row.exitCode }),
  ...(row.finishedAt ? { finishedAt: row.finishedAt.toISOString() } : {}),
  id: row.id,
  profileId: row.profileId,
  startedAt: row.startedAt.toISOString(),
  status: row.status,
});

const STATUS_HINT: Record<SandboxJobStatus, string> = {
  cancelled:
    'The job was stopped before it finished. Output and files it produced so far are included.',
  failed: 'The job exited with an error. Read the output to see why.',
  lost: 'The job did not finish. Start it again with startJob if it is still needed.',
  running:
    'Still running. Tell the user it is in progress and check again with getJobResult when they ask; do not wait for it in a loop.',
  succeeded: 'The job finished. When you share a kept file, link its files[].url exactly.',
  timed_out:
    'The job reached its runtime limit and was stopped. Output and files it produced so far are included.',
};

const UNSUCCESSFUL = new Set<SandboxJobStatus>(['failed', 'lost', 'timed_out']);

/** What the model sees for one job. A running job shows its live output when given. */
export const toJobResult = (row: SandboxJobRow, live?: { log?: string }): SandboxToolResult => {
  const running = row.status === 'running';
  const end = row.finishedAt?.getTime() ?? Date.now();
  const log = running ? live?.log : (row.outputTail ?? undefined);
  return {
    ...(running ? { deadlineAt: row.deadlineAt.toISOString() } : {}),
    durationMs: Math.max(0, end - row.startedAt.getTime()),
    ...(row.error ? { error: row.error } : {}),
    ...(row.exitCode === null ? {} : { exitCode: row.exitCode }),
    ...(row.files?.length ? { files: row.files } : {}),
    ...(row.finishedAt ? { finishedAt: row.finishedAt.toISOString() } : {}),
    hint: STATUS_HINT[row.status],
    jobId: row.id,
    jobStatus: row.status,
    ...(log ? { log } : {}),
    running,
    startedAt: row.startedAt.toISOString(),
    success: !UNSUCCESSFUL.has(row.status),
  };
};

export const markSandboxJobLost = async (
  db: LobeChatDatabase,
  userId: string,
  row: SandboxJobRow,
  reason: string,
): Promise<SandboxJobRow> => {
  const model = new SandboxJobModel(db, userId);
  return (
    (await model.finish(row.id, { error: reason, status: 'lost' })) ??
    (await model.find(row.id)) ??
    row
  );
};

/** A 30s execd step abort. Leaving this to the provider deletes the sandbox. */
const isStepTimeout = (error: unknown) =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

const OUTPUT_UNREAD_NOTE = 'the command output could not be read in time';
const FOLDER_UNREAD_NOTE = 'the output folder could not be read in time';

const readOutput = async (
  workspace: SandboxWorkspace,
  commandId: string,
): Promise<{ log?: string; unread?: boolean }> => {
  try {
    const logs = await workspace.commandLogs(commandId);
    return { log: logs.output || undefined };
  } catch (error) {
    if (error instanceof SandboxRequestError) return {};
    if (isStepTimeout(error)) return { unread: true };
    throw error;
  }
};

/**
 * Copies the files in the job's output folder to chat storage, within the
 * per-call file limits. A storage failure is reported, not thrown: it is not
 * a sandbox fault, and throwing would make the provider discard the sandbox.
 */
const keepOutputFiles = async ({
  db,
  outputDir,
  userId,
  workspace,
}: {
  db: LobeChatDatabase;
  outputDir: string;
  userId: string;
  workspace: SandboxWorkspace;
}): Promise<{ files: SandboxJobFile[]; skipped: string[] }> => {
  let entries;
  try {
    entries = await workspace.listDirectory(outputDir, OUTPUT_LIST_DEPTH);
  } catch (error) {
    if (error instanceof SandboxRequestError) {
      return { files: [], skipped: [`${outputDir}: ${error.message}`] };
    }
    if (isStepTimeout(error)) {
      return { files: [], skipped: [`${outputDir}: ${FOLDER_UNREAD_NOTE}`] };
    }
    throw error;
  }
  const paths = entries
    .filter(
      (entry) =>
        entry.type === 'file' &&
        entry.path !== SANDBOX_CONTROL_DIR &&
        !entry.path.startsWith(`${SANDBOX_CONTROL_DIR}/`),
    )
    .map((entry) => entry.path)
    .sort();
  const limit = sandboxEnv.SANDBOX_MAX_FILE_COUNT;
  const picked = paths.slice(0, limit);
  let files;
  let skipped;
  try {
    ({ files, skipped } = await loadSandboxFiles(
      workspace,
      picked.map((path) => ({ label: posix.relative(outputDir, path) || path, resolved: path })),
      sandboxEnv.SANDBOX_MAX_FILE_BYTES,
    ));
  } catch (error) {
    if (!isStepTimeout(error)) throw error;
    return { files: [], skipped: [`${outputDir}: ${FOLDER_UNREAD_NOTE}`] };
  }
  if (paths.length > picked.length) {
    skipped.push(`${paths.length - picked.length} more file(s) over the ${limit}-file limit`);
  }
  if (files.length === 0) return { files: [], skipped };

  try {
    const persisted = await persistSandboxOutputFiles({ db, files, userId });
    const kept = persisted.map(({ fileId, filename, url }) => ({ fileId, filename, url }));
    await workspace.markSynced(kept.flatMap((file) => (file.fileId ? [file.fileId] : [])));
    if (kept.length < files.length) {
      skipped.push(`${files.length - kept.length} file(s) could not be stored`);
    }
    return { files: kept, skipped };
  } catch (error) {
    if (error instanceof SandboxError && !(error instanceof SandboxRequestError)) throw error;
    skipped.push(
      `the files could not be stored (${error instanceof Error ? error.name : 'error'})`,
    );
    return { files: [], skipped };
  }
};

type Observation =
  | { kind: 'gone' }
  | { kind: 'running'; log?: string }
  | {
      ending: Ending;
      files: SandboxJobFile[];
      kind: 'ended';
      outputTail?: string;
      skipped: string[];
    };

const interruptQuietly = async (workspace: SandboxWorkspace, commandId: string) => {
  try {
    await workspace.interrupt(commandId);
  } catch (error) {
    // Already ended between the status read and the stop.
    if (!(error instanceof SandboxRequestError)) throw error;
  }
};

/** Sandbox side of one check. Never writes the job row. */
const observeJob = async ({
  db,
  now,
  row,
  stopReason,
  userId,
  withLog,
  workspace,
}: {
  db: LobeChatDatabase;
  now: number;
  row: SandboxJobRow;
  stopReason?: string;
  userId: string;
  withLog?: boolean;
  workspace: SandboxWorkspace;
}): Promise<Observation> => {
  let status;
  try {
    status = await workspace.commandStatus(row.commandId);
  } catch (error) {
    if (error instanceof SandboxRequestError) return { kind: 'gone' };
    throw error;
  }

  let ending: Ending | undefined;
  if (!status.running) {
    ending =
      status.exitCode === 0
        ? { exitCode: 0, status: 'succeeded' }
        : {
            error: status.error || `The command exited with code ${status.exitCode ?? 'unknown'}.`,
            exitCode: status.exitCode,
            status: 'failed',
          };
  } else if (stopReason !== undefined) {
    await interruptQuietly(workspace, row.commandId);
    ending = { error: stopReason, status: 'cancelled' };
  } else if (now >= row.deadlineAt.getTime()) {
    await interruptQuietly(workspace, row.commandId);
    const limit = minutes(row.deadlineAt.getTime() - row.startedAt.getTime());
    ending = { error: `Stopped at its ${limit}-minute runtime limit.`, status: 'timed_out' };
  }

  if (!ending) {
    if (!withLog) return { kind: 'running' };
    const read = await readOutput(workspace, row.commandId);
    return { kind: 'running', ...(read.log ? { log: read.log } : {}) };
  }
  const read = await readOutput(workspace, row.commandId);
  const kept = row.outputDir
    ? await keepOutputFiles({ db, outputDir: row.outputDir, userId, workspace })
    : { files: [], skipped: [] as string[] };
  if (read.unread) kept.skipped.push(OUTPUT_UNREAD_NOTE);
  return { ...kept, ending, kind: 'ended', outputTail: read.log };
};

/**
 * Runs `task` in the job's own sandbox (its profile and conversation) and
 * never creates one. A profile turned off in the Hub is still reached so the
 * job can be stopped; `stopReason` then carries why. Any other gate failure
 * (a settings read error, a missing key) is not a reason to stop the job.
 */
const inJobSandbox = async <T>({
  apiName,
  db,
  row,
  task,
  userId,
}: {
  apiName: string;
  db: LobeChatDatabase;
  row: SandboxJobRow;
  task: (workspace: SandboxWorkspace, stopReason: string | undefined) => Promise<T>;
  userId: string;
}): Promise<{ ok: false; reason: string } | { ok: true; value: T }> => {
  const gate = await resolveSandboxProfileForUser({
    db,
    identifier: sandboxToolIdentifier(row.profileId),
    userId,
  });
  const profile = gate.ok ? gate.profile : findSandboxProfile(row.profileId);
  const server = gate.ok ? gate.server : profile && findSandboxServer(profile.serverId);
  if (!profile || !server) {
    return {
      ok: false,
      reason: gate.ok
        ? `The "${row.profileId}" sandbox is no longer configured on this server.`
        : gate.message,
    };
  }
  const stopReason = !gate.ok && gate.reason === 'disabled' ? gate.message : undefined;
  const value = await getSandboxProvider(profile, server).withWorkspace(
    {
      apiName,
      budgetMs: SANDBOX_JOB_CHECK_BUDGET_MS,
      createIfMissing: false,
      sessionKey: row.sessionKey,
    },
    (workspace) => task(workspace, stopReason),
  );
  return { ok: true, value };
};

/**
 * One look at a running job, which also renews its sandbox: saves the result
 * when the command has ended, stops it when asked, when its profile was
 * turned off, or past its deadline, and marks it lost when its sandbox is
 * gone. Database writes happen after the sandbox call, so a database error
 * never makes the provider discard a healthy sandbox.
 */
export const checkSandboxJob = async ({
  apiName,
  db,
  now = Date.now(),
  row,
  stopReason,
  userId,
  withLog,
}: {
  apiName: string;
  db: LobeChatDatabase;
  now?: number;
  row: SandboxJobRow;
  stopReason?: string;
  userId: string;
  withLog?: boolean;
}): Promise<{ log?: string; row: SandboxJobRow }> => {
  let opened;
  try {
    opened = await inJobSandbox({
      apiName,
      db,
      row,
      task: (workspace, blocked) =>
        observeJob({
          db,
          now,
          row,
          stopReason: stopReason ?? blocked,
          userId,
          withLog,
          workspace,
        }),
      userId,
    });
  } catch (error) {
    if (error instanceof SandboxError && error.code === 'NotFound') {
      return { row: await markSandboxJobLost(db, userId, row, SANDBOX_GONE_MESSAGE) };
    }
    throw error;
  }
  if (!opened.ok) return { row: await markSandboxJobLost(db, userId, row, opened.reason) };

  const observed = opened.value;
  if (observed.kind === 'gone') {
    return { row: await markSandboxJobLost(db, userId, row, COMMAND_GONE_MESSAGE) };
  }

  const model = new SandboxJobModel(db, userId);
  const checkedAt = new Date(now);
  if (observed.kind === 'running') {
    await model.markChecked(row.id, checkedAt);
    return { log: observed.log, row: { ...row, lastCheckedAt: checkedAt } };
  }

  const notes = observed.skipped.length > 0 ? `Not kept: ${observed.skipped.join('; ')}` : '';
  const error = [observed.ending.error, notes].filter(Boolean).join('\n');
  const saved = await model.finish(row.id, {
    ...observed.ending,
    ...(error ? { error } : {}),
    files: observed.files,
    outputTail: observed.outputTail,
  });
  return { row: saved ?? (await model.find(row.id)) ?? row };
};
