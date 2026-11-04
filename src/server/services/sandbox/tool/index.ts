import { posix } from 'node:path';

import type { LobeChatDatabase } from '@lobechat/database';
import type { CodeInterpreterResponse, SandboxToolResult } from '@lobechat/types';

import { SandboxJobModel } from '@/database/models/sandboxJob';
import { sandboxEnv } from '@/envs/sandbox';
import {
  SANDBOX_CONTROL_DIR,
  SandboxApiName,
  SandboxIdentifier,
  resolveSandboxApiName,
} from '@/tools/sandbox/const';

import { listConversationSandboxInputs, persistSandboxOutputFiles } from '../conversationFiles';
import { loadSandboxFiles } from '../exportFiles';
import { SANDBOX_JOB_COMMAND_MAX_CHARS, sandboxJobWatchDelayMs } from '../jobs/constants';
import { enqueueSandboxJobWatch } from '../jobs/enqueue';
import { toJobResult } from '../jobs/lifecycle';
import { cancelSandboxJob, getSandboxJobResult, listSandboxJobs } from '../jobs/service';
import { resolveSandboxProfileForUser } from '../profiles/catalog';
import {
  encryptSandboxEnvSnapshot,
  maskSandboxSecrets,
  resolveSandboxEnv,
  resolveSandboxMaskEnv,
  sandboxEnvFingerprint,
} from '../profiles/env';
import {
  type ResolvedSandboxFiles,
  encryptSandboxFileSnapshot,
  resolveSandboxFiles,
  sandboxFilesFingerprint,
} from '../profiles/files';
import type { ResolvedSandboxProfile, ResolvedSandboxServer } from '../profiles/schema';
import { getSandboxProvider } from '../registry';
import { buildSandboxSessionKey, type SandboxConversationScope } from '../session';
import {
  SandboxError,
  type SandboxFile,
  type SandboxInputRef,
  type SandboxProvider,
  type SandboxWorkspace,
} from '../types';
import { decodeText, formatNumberedLines, resolveTimeoutMs } from './format';
import { isSandboxApiName, sandboxToolSchemas, type SandboxToolArgs } from './schemas';

// Budget for calls that only touch files or command metadata.
const FILE_BUDGET_MS = 60_000;
const LIST_MAX_ENTRIES = 500;
const LIST_DEFAULT_DEPTH = 2;
const LIST_MAX_DEPTH = 5;
const MAX_ERROR_CHARS = 100_000;

const NO_SESSIONS_ERROR =
  'Background commands need a sandbox that stays alive between calls, but this sandbox starts fresh for every call (its idle timeout is 0). Run the command in the foreground instead.';
const JOBS_OFF_ERROR =
  'Background jobs are turned off for this sandbox. Run the command with runCommand instead.';

/** Single-quotes a value for bash. */
const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export interface InvokeSandboxToolParams extends Omit<SandboxConversationScope, 'profileId'> {
  apiName: string;
  args: Record<string, unknown>;
  db: LobeChatDatabase;
  /** Tool identifier the model called; picks the Sandbox Hub profile. Defaults to `lobe-sandbox`. */
  identifier?: string;
  operationHash?: string;
  signal?: AbortSignal;
}

const clip = (message: string) =>
  message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}\n…[error truncated]` : message;

const failure = (message: string, extra?: Partial<SandboxToolResult>): SandboxToolResult => ({
  ...extra,
  error: clip(message),
  success: false,
});

const jobNotFound = (jobId: string) =>
  failure(`No background job "${jobId}" was found. Use listJobs to see this conversation's jobs.`);

/** runPython keeps the Code Interpreter shape: errors arrive as stderr output. */
const pythonFailure = (message: string): CodeInterpreterResponse => ({
  output: [{ data: clip(message), type: 'stderr' }],
  success: false,
});

const toOutput = (stdout: string, stderr: string): CodeInterpreterResponse['output'] => {
  const output: NonNullable<CodeInterpreterResponse['output']> = [];
  if (stdout) output.push({ data: stdout, type: 'stdout' });
  if (stderr) output.push({ data: stderr, type: 'stderr' });
  return output.length > 0 ? output : undefined;
};

const utf8 = (value: string) => new Uint8Array(Buffer.from(value, 'utf8'));

const describeIssues = (issues: { message: string; path: (number | string)[] }[]) =>
  issues.map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`).join('; ');

class SandboxToolRunner {
  private readonly env: Record<string, string>;
  /** Sensitive values only. Command output and the job snapshot use this. */
  private readonly maskEnv: Record<string, string>;
  /** Sensitive file texts. Command output and the job snapshot use this. */
  private readonly fileMask: readonly string[];
  private readonly maxFileBytes = sandboxEnv.SANDBOX_MAX_FILE_BYTES;
  private readonly maxFileCount = sandboxEnv.SANDBOX_MAX_FILE_COUNT;
  private readonly profile: ResolvedSandboxProfile;
  private readonly provider: SandboxProvider;
  private readonly sessionKey: string;

  constructor(
    private readonly params: InvokeSandboxToolParams,
    target: { profile: ResolvedSandboxProfile; server: ResolvedSandboxServer },
    /** Sandbox Hub variables for this user's sandbox of this profile. */
    env: Record<string, string>,
    maskEnv: Record<string, string>,
    /** Sandbox Hub files written into a new sandbox before its first command. */
    files: ResolvedSandboxFiles,
  ) {
    this.env = env;
    this.maskEnv = maskEnv;
    this.fileMask = files.mask;
    this.profile = target.profile;
    this.provider = getSandboxProvider(target.profile, target.server, {
      env: { fingerprint: sandboxEnvFingerprint(env), values: env },
      files: { fingerprint: sandboxFilesFingerprint(files.items), items: files.items },
    });
    this.sessionKey = buildSandboxSessionKey({ ...params, profileId: target.profile.id });
  }

  private timeoutMs(seconds: number | undefined) {
    return resolveTimeoutMs(seconds, {
      defaultMs: sandboxEnv.SANDBOX_TIMEOUT,
      maxMs: sandboxEnv.SANDBOX_MAX_TIMEOUT,
    });
  }

  private inputs(): Promise<SandboxInputRef[]> {
    const { db, groupId, sessionId, threadId, topicId, userId } = this.params;
    return listConversationSandboxInputs({ db, groupId, sessionId, threadId, topicId, userId });
  }

  private use<T>(
    apiName: string,
    budgetMs: number,
    task: (workspace: SandboxWorkspace) => Promise<T>,
    createIfMissing?: boolean,
  ) {
    return this.provider.withWorkspace(
      {
        apiName,
        budgetMs,
        createIfMissing,
        operationHash: this.params.operationHash,
        sessionKey: this.sessionKey,
        signal: this.params.signal,
      },
      task,
    );
  }

  /** Workspace with this conversation's files in place. */
  private async useWithInputs<T>(
    apiName: string,
    budgetMs: number,
    task: (workspace: SandboxWorkspace) => Promise<T>,
  ) {
    const inputs = await this.inputs();
    return this.use(apiName, budgetMs, async (workspace) => {
      await workspace.syncInputs(inputs);
      return task(workspace);
    });
  }

  private resolvePath(workspace: SandboxWorkspace, path: string) {
    return posix.resolve(workspace.workdir, path);
  }

  private async persist(workspace: SandboxWorkspace, files: SandboxFile[]) {
    const { db, userId } = this.params;
    const persisted = await persistSandboxOutputFiles({ db, files, userId });
    await workspace.markSynced(persisted.flatMap((file) => (file.fileId ? [file.fileId] : [])));
    return persisted;
  }

  runCommand({ background, command, cwd, timeout }: SandboxToolArgs['runCommand']) {
    if (background) {
      if (!this.provider.keepsSessions) return Promise.resolve(failure(NO_SESSIONS_ERROR));
      return this.useWithInputs(SandboxApiName.runCommand, FILE_BUDGET_MS, async (workspace) => {
        const resolvedCwd = cwd ? this.resolvePath(workspace, cwd) : undefined;
        const commandId = await workspace.startBackground({ command, cwd: resolvedCwd });
        return {
          background: true,
          commandId,
          hint: 'Started in the background. Use getCommandOutput to read its output and stopCommand to end it.',
          success: true,
        } satisfies SandboxToolResult;
      });
    }

    const timeoutMs = this.timeoutMs(timeout);
    return this.useWithInputs(SandboxApiName.runCommand, timeoutMs, async (workspace) => {
      const resolvedCwd = cwd ? this.resolvePath(workspace, cwd) : undefined;
      const result = await workspace.exec({ command, cwd: resolvedCwd, timeoutMs });
      let hint: string | undefined;
      if (result.timedOut) {
        hint = `Stopped after the ${Math.round(timeoutMs / 1000)}s time limit; output so far is shown. Pass a longer timeout, or run it with background: true.`;
      } else if (result.killed) {
        hint = 'The process was killed before it finished (it may have run out of memory).';
      }
      return {
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        ...(hint ? { hint } : {}),
        stderr: result.stderr,
        stdout: result.stdout,
        success: !result.timedOut && !result.killed && result.exitCode === 0,
        ...(result.timedOut ? { timedOut: true } : {}),
      } satisfies SandboxToolResult;
    });
  }

  getCommandOutput({ commandId, cursor }: SandboxToolArgs['getCommandOutput']) {
    if (!this.provider.keepsSessions) return Promise.resolve(failure(NO_SESSIONS_ERROR));
    const from = cursor !== undefined && cursor >= 0 ? Math.floor(cursor) : undefined;
    return this.use(
      SandboxApiName.getCommandOutput,
      FILE_BUDGET_MS,
      async (workspace) => {
        const status = await workspace.commandStatus(commandId);
        const logs = await workspace.commandLogs(commandId, from);
        return {
          commandId,
          ...(status.error ? { error: status.error } : {}),
          exitCode: status.exitCode,
          log: logs.output,
          nextCursor: logs.cursor,
          running: status.running,
          success: status.running || status.exitCode === 0,
        } satisfies SandboxToolResult;
      },
      false,
    );
  }

  stopCommand({ commandId }: SandboxToolArgs['stopCommand']) {
    if (!this.provider.keepsSessions) return Promise.resolve(failure(NO_SESSIONS_ERROR));
    return this.use(
      SandboxApiName.stopCommand,
      FILE_BUDGET_MS,
      async (workspace) => {
        await workspace.interrupt(commandId);
        return { commandId, success: true } satisfies SandboxToolResult;
      },
      false,
    );
  }

  async startJob({
    command,
    cwd,
    maxRuntimeMinutes,
    outputDir,
  }: SandboxToolArgs['startJob']): Promise<SandboxToolResult> {
    if (!this.provider.keepsSessions) return failure(NO_SESSIONS_ERROR);
    const limitMs = this.profile.jobMaxRuntimeMs;
    if (limitMs <= 0) return failure(JOBS_OFF_ERROR);
    const requestedMs =
      maxRuntimeMinutes && maxRuntimeMinutes > 0 ? Math.round(maxRuntimeMinutes * 60_000) : limitMs;
    const runtimeMs = Math.min(limitMs, requestedMs);

    const { db, userId } = this.params;
    const model = new SandboxJobModel(db, userId);
    const running = await model.countRunning();
    if (running >= sandboxEnv.SANDBOX_JOB_MAX_RUNNING) {
      return failure(
        `${running} background jobs are already running, the most this server allows per user. Wait for one to end, or stop one with cancelJob.`,
      );
    }

    const started = await this.useWithInputs(
      SandboxApiName.startJob,
      FILE_BUDGET_MS,
      async (workspace) => {
        const resolvedCwd = cwd ? this.resolvePath(workspace, cwd) : undefined;
        const resolvedOutput = outputDir ? this.resolvePath(workspace, outputDir) : undefined;
        if (resolvedOutput) {
          const made = await workspace.exec({
            command: `mkdir -p -- ${shellQuote(resolvedOutput)}`,
            timeoutMs: 10_000,
          });
          if (made.exitCode !== 0) {
            const reason = made.stderr.trim() || `exit code ${made.exitCode}`;
            return {
              error: `Could not create the output folder ${resolvedOutput}: ${reason}`,
              ok: false as const,
            };
          }
        }
        const commandId = await workspace.startBackground({ command, cwd: resolvedCwd });
        return { commandId, cwd: resolvedCwd, ok: true as const, outputDir: resolvedOutput };
      },
    );
    if (!started.ok) return failure(started.error);

    const startedAt = new Date();
    let row;
    try {
      row = await model.create({
        command: command.slice(0, SANDBOX_JOB_COMMAND_MAX_CHARS),
        commandId: started.commandId,
        cwd: started.cwd,
        deadlineAt: new Date(startedAt.getTime() + runtimeMs),
        envSnapshot: await encryptSandboxEnvSnapshot(this.maskEnv),
        fileSnapshot: await encryptSandboxFileSnapshot(this.fileMask),
        outputDir: started.outputDir,
        profileId: this.profile.id,
        sessionKey: this.sessionKey,
        startedAt,
      });
    } catch (error) {
      // Without a record nothing would watch or stop the command.
      await this.use(
        SandboxApiName.cancelJob,
        FILE_BUDGET_MS,
        (workspace) => workspace.interrupt(started.commandId),
        false,
      ).catch(() => undefined);
      throw error;
    }

    let watched = true;
    try {
      await enqueueSandboxJobWatch(
        db,
        { jobId: row.id, userId },
        new Date(Date.now() + sandboxJobWatchDelayMs(this.profile.sessionIdleTimeoutMs)),
      );
    } catch (error) {
      watched = false;
      console.warn('[sandbox] could not queue the background job watcher', {
        errorClass: error instanceof Error ? error.name : typeof error,
      });
    }

    const minutes = Math.round(runtimeMs / 60_000);
    const idleMinutes = Math.max(1, Math.round(this.profile.sessionIdleTimeoutMs / 60_000));
    const kept = row.outputDir ? ` Files written to ${row.outputDir} are kept when it ends.` : '';
    return {
      deadlineAt: row.deadlineAt.toISOString(),
      hint: watched
        ? `Started. It keeps running after this reply for up to ${minutes} minutes.${kept} Tell the user the jobId, then read the result with getJobResult when they ask.`
        : `Started, but no job worker is running on this server, so the job ends if this sandbox gets no call for ${idleMinutes} minutes.${kept} Check it with getJobResult before then.`,
      jobId: row.id,
      jobStatus: 'running',
      running: true,
      startedAt: row.startedAt.toISOString(),
      success: true,
    } satisfies SandboxToolResult;
  }

  async getJobResult({ jobId }: SandboxToolArgs['getJobResult']): Promise<SandboxToolResult> {
    const { db, userId } = this.params;
    const result = await getSandboxJobResult({ db, jobId, userId });
    return result ?? jobNotFound(jobId);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listJobs(_args: SandboxToolArgs['listJobs']): Promise<SandboxToolResult> {
    const { db, userId } = this.params;
    const jobs = await listSandboxJobs({ db, sessionKey: this.sessionKey, userId });
    return {
      ...(jobs.length === 0
        ? { hint: 'No background jobs were started in this conversation with this sandbox.' }
        : {}),
      jobs,
      success: true,
    } satisfies SandboxToolResult;
  }

  async cancelJob({ jobId }: SandboxToolArgs['cancelJob']): Promise<SandboxToolResult> {
    const { db, userId } = this.params;
    const row = await cancelSandboxJob({ db, jobId, reason: 'Stopped with cancelJob.', userId });
    return row ? toJobResult(row) : jobNotFound(jobId);
  }

  async runPython({ code, timeout }: SandboxToolArgs['runPython']): Promise<SandboxToolResult> {
    if (!code.trim()) return pythonFailure('runPython received empty code.');
    const timeoutMs = this.timeoutMs(timeout);
    const inputs = await this.inputs();
    return this.use(SandboxApiName.runPython, timeoutMs, async (workspace) => {
      const result = await workspace.runPython({ code, inputs, timeoutMs });
      const persisted = await this.persist(workspace, result.files);
      return {
        files: persisted.length > 0 ? persisted : undefined,
        ...(result.hint ? { hint: result.hint } : {}),
        output: toOutput(result.stdout, result.stderr),
        success: result.success,
      };
    });
  }

  readFile({ limit, offset, path }: SandboxToolArgs['readFile']) {
    return this.useWithInputs(SandboxApiName.readFile, FILE_BUDGET_MS, async (workspace) => {
      const resolved = this.resolvePath(workspace, path);
      const bytes = await workspace.readFile(resolved, this.maxFileBytes);
      const text = decodeText(bytes);
      if (text === undefined) {
        return {
          binary: true,
          hint: 'Binary file. Share it with exportFile, or inspect it with runCommand (file, xxd | head).',
          path: resolved,
          size: bytes.byteLength,
          success: true,
        } satisfies SandboxToolResult;
      }
      return {
        ...formatNumberedLines(text, { limit, offset }),
        path: resolved,
        success: true,
      } satisfies SandboxToolResult;
    });
  }

  writeFile({ content, path }: SandboxToolArgs['writeFile']) {
    const bytes = utf8(content);
    if (bytes.byteLength > this.maxFileBytes) {
      return Promise.resolve(
        failure(`The content is ${bytes.byteLength} bytes, over the ${this.maxFileBytes}-byte limit.`),
      );
    }
    return this.useWithInputs(SandboxApiName.writeFile, FILE_BUDGET_MS, async (workspace) => {
      const resolved = this.resolvePath(workspace, path);
      await workspace.writeFile(resolved, bytes);
      return { bytes: bytes.byteLength, path: resolved, success: true } satisfies SandboxToolResult;
    });
  }

  editFile({ newString, oldString, path, replaceAll }: SandboxToolArgs['editFile']) {
    if (oldString === newString) {
      return Promise.resolve(failure('oldString and newString are the same; nothing to change.'));
    }
    return this.useWithInputs(SandboxApiName.editFile, FILE_BUDGET_MS, async (workspace) => {
      const resolved = this.resolvePath(workspace, path);
      const text = decodeText(await workspace.readFile(resolved, this.maxFileBytes));
      if (text === undefined) return failure(`${resolved} is not a text file.`, { path: resolved });

      const count = text.split(oldString).length - 1;
      if (count === 0) {
        return failure(
          `oldString was not found in ${resolved}. Read the file and copy the exact text, including whitespace.`,
          { path: resolved },
        );
      }
      if (count > 1 && !replaceAll) {
        return failure(
          `oldString appears ${count} times in ${resolved}. Include more surrounding lines to make it unique, or set replaceAll.`,
          { path: resolved },
        );
      }
      const index = text.indexOf(oldString);
      const next = replaceAll
        ? text.split(oldString).join(newString)
        : text.slice(0, index) + newString + text.slice(index + oldString.length);
      const bytes = utf8(next);
      if (bytes.byteLength > this.maxFileBytes) {
        return failure(`The edited file would exceed the ${this.maxFileBytes}-byte limit.`, {
          path: resolved,
        });
      }
      await workspace.writeFile(resolved, bytes);
      return {
        path: resolved,
        replacements: replaceAll ? count : 1,
        success: true,
      } satisfies SandboxToolResult;
    });
  }

  listFiles({ depth, path }: SandboxToolArgs['listFiles']) {
    const levels = Math.min(
      LIST_MAX_DEPTH,
      Math.max(1, Math.floor(depth && Number.isFinite(depth) ? depth : LIST_DEFAULT_DEPTH)),
    );
    return this.useWithInputs(SandboxApiName.listFiles, FILE_BUDGET_MS, async (workspace) => {
      const resolved = this.resolvePath(workspace, path ?? workspace.workdir);
      const listed = await workspace.listDirectory(resolved, levels);
      const entries = listed.filter(
        (entry) =>
          entry.path !== SANDBOX_CONTROL_DIR && !entry.path.startsWith(`${SANDBOX_CONTROL_DIR}/`),
      );
      return {
        entries: entries.slice(0, LIST_MAX_ENTRIES).map((entry) => ({
          path: entry.path,
          ...(entry.type === 'file' ? { size: entry.size } : {}),
          type: entry.type,
        })),
        path: resolved,
        success: true,
        ...(entries.length > LIST_MAX_ENTRIES
          ? {
              hint: `Showing ${LIST_MAX_ENTRIES} of ${entries.length} entries. List a subdirectory or a smaller depth, or use runCommand (find, rg --files).`,
              truncated: true,
            }
          : {}),
      } satisfies SandboxToolResult;
    });
  }

  /** A path with commas or newlines that does not exist as written is a list of paths. */
  private async expandListedPaths(workspace: SandboxWorkspace, paths: string[]) {
    const expanded: string[] = [];
    for (const path of paths) {
      const parts = path
        .split(/[\n,]/)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 1 && !(await workspace.fileInfo(this.resolvePath(workspace, path)))) {
        expanded.push(...parts);
      } else {
        expanded.push(path);
      }
    }
    return expanded;
  }

  exportFile({ paths }: SandboxToolArgs['exportFile']) {
    return this.useWithInputs(SandboxApiName.exportFile, FILE_BUDGET_MS, async (workspace) => {
      const unique = [...new Set(await this.expandListedPaths(workspace, paths))];
      const { files, skipped } = await loadSandboxFiles(
        workspace,
        unique
          .slice(0, this.maxFileCount)
          .map((path) => ({ label: path, resolved: this.resolvePath(workspace, path) })),
        this.maxFileBytes,
      );
      const persisted = files.length > 0 ? await this.persist(workspace, files) : [];
      if (persisted.length < files.length) {
        skipped.push(`${files.length - persisted.length} file(s) could not be stored`);
      }
      if (unique.length > this.maxFileCount) {
        const rest = unique.slice(this.maxFileCount);
        const shown = rest.slice(0, 50);
        const extra = rest.length - shown.length;
        skipped.push(
          `over the ${this.maxFileCount}-file limit, not exported; call exportFile again with: ${shown.join(', ')}${extra > 0 ? `, and ${extra} more` : ''}`,
        );
      }
      return {
        ...(persisted.length > 0 ? { files: persisted } : {}),
        ...(skipped.length > 0 ? { skipped } : {}),
        ...(persisted.length === 0 ? { error: 'No file was exported.' } : {}),
        success: persisted.length > 0,
      } satisfies SandboxToolResult;
    });
  }
}

const throwIfCallerCancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new SandboxError('Cancelled', 'The sandbox call was cancelled.');
  }
};

/**
 * Runs one Sandbox tool call for a conversation and returns the result the
 * model sees (serialized as the tool message content). A caller abort is
 * rethrown even when the workspace swallowed it and resolved (Python output
 * collection and the sync record do that). Every other failure comes back as
 * `success: false`. Sandbox Hub variable values in the result are masked.
 */
export const invokeSandboxTool = async (
  params: InvokeSandboxToolParams,
): Promise<SandboxToolResult> => {
  throwIfCallerCancelled(params.signal);
  const apiName = resolveSandboxApiName(params.apiName);
  const isPython = apiName === SandboxApiName.runPython;

  if (!isSandboxApiName(apiName)) {
    return failure(`Unknown Sandbox API "${params.apiName}".`);
  }
  const parsed = sandboxToolSchemas[apiName].safeParse(params.args ?? {});
  if (!parsed.success) {
    const message = `Invalid arguments for ${apiName}: ${describeIssues(parsed.error.issues)}`;
    return isPython ? pythonFailure(message) : failure(message);
  }

  const target = await resolveSandboxProfileForUser({
    db: params.db,
    identifier: params.identifier ?? SandboxIdentifier,
    userId: params.userId,
  });
  if (!target.ok) return isPython ? pythonFailure(target.message) : failure(target.message);

  let env: Record<string, string>;
  let maskEnv: Record<string, string>;
  try {
    env = await resolveSandboxEnv(params.db, params.userId, target.profile.id);
    maskEnv = await resolveSandboxMaskEnv(params.db, params.userId, target.profile.id);
  } catch (error) {
    // Without them a new sandbox would start without its variables.
    console.warn('[sandbox] could not read environment variables; the call was refused', {
      errorClass: error instanceof Error ? error.name : typeof error,
      profileId: target.profile.id,
    });
    const message = 'The sandbox environment variables could not be read. Try again.';
    return isPython ? pythonFailure(message) : failure(message);
  }

  let files: ResolvedSandboxFiles;
  try {
    files = await resolveSandboxFiles(params.db, params.userId, target.profile.id);
  } catch (error) {
    // Without them a new sandbox would start without its files.
    console.warn('[sandbox] could not read Sandbox Hub files; the call was refused', {
      errorClass: error instanceof Error ? error.name : typeof error,
      profileId: target.profile.id,
    });
    const message = 'The sandbox files could not be read. Try again.';
    return isPython ? pythonFailure(message) : failure(message);
  }

  const runner = new SandboxToolRunner(params, target, env, maskEnv, files);
  try {
    // The schema for each API name produces that API's arguments.
    const call = runner[apiName].bind(runner) as (args: unknown) => Promise<SandboxToolResult>;
    const result = await call(parsed.data);
    throwIfCallerCancelled(params.signal);
    return maskSandboxSecrets(result, maskEnv, files.mask);
  } catch (error) {
    if (params.signal?.aborted || (error instanceof SandboxError && error.code === 'Cancelled')) {
      throw error;
    }
    const message =
      error instanceof SandboxError || error instanceof Error ? error.message : 'Sandbox failed.';
    return maskSandboxSecrets(
      isPython ? pythonFailure(message) : failure(message),
      maskEnv,
      files.mask,
    );
  }
};
