import { createHash } from 'node:crypto';

import { logGenerationDebugSafe } from '@/libs/logger/generationDebug';

import { OutputCollector } from '../../text';
import {
  type SandboxCommandLogs,
  type SandboxCommandResult,
  type SandboxCommandStatus,
  type SandboxEntry,
  type SandboxEntryType,
  SandboxError,
  type SandboxFile,
  type SandboxInputRef,
  type SandboxPythonResult,
  SandboxRequestError,
  type SandboxWorkspace,
} from '../../types';
import {
  type ExecdEndpoint,
  type ExecdFileInfo,
  OPENSANDBOX_MANIFEST_MAX_BYTES,
  type OpenSandboxClient,
  OpenSandboxHttpError,
} from './client';
import {
  buildRunnerScript,
  CONTROL_DIR,
  MANIFEST_PATH,
  OPENSANDBOX_WORKDIR,
  parseOutputManifest,
  RUN_COMMAND,
  RUNNER_PATH,
  SYNCED_PATH,
  USER_CODE_PATH,
} from './python';

/** What the workspace was doing when a step failed; drives error classification. */
export type WorkspacePhase = 'collect' | 'command' | 'files' | 'ready' | 'run' | 'upload';

export const STEP_TIMEOUT_MS = 30_000;
// execd kills the process at the run timeout; the client waits a little
// longer so the kill is reported instead of racing an abort.
export const RUN_ABORT_GRACE_MS = 5000;
const INTERRUPT_TIMEOUT_MS = 5000;
// execd reports a signal death as exit "-1" with "signal: killed".
const KILLED_EXIT = '-1';
// The sync record is a JSON list of file ids; ChatHub writes it, but it lives
// in the guest, so reads are capped.
const SYNCED_MAX_BYTES = 256 * 1024;
// Inputs with this name would collide with the control directory.
const CONTROL_NAME = CONTROL_DIR.split('/').pop()!;

export interface WorkspaceLimits {
  maxFileBytes: number;
  maxFileCount: number;
  maxOutputChars: number;
}

export interface WorkspaceStats {
  exitCode?: number;
  fileInCount: number;
  fileOutCount: number;
  stdoutChars: number;
  timedOut?: boolean;
}

interface StreamResult {
  exitCode?: number;
  killed: boolean;
  stderr: string;
  stdout: string;
  stdoutChars: number;
}

export const combineSignals = (...signals: Array<AbortSignal | undefined>) => {
  const present = signals.filter((signal): signal is AbortSignal => !!signal);
  return present.length === 1 ? present[0] : AbortSignal.any(present);
};

const safeBasename = (filename: string) => {
  const name = filename.replaceAll('\\', '/').split('/').pop() ?? '';
  if (!name || name === '.' || name === '..') return undefined;
  return name;
};

const sha256Hex = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');

const utf8 = (value: string) => new Uint8Array(Buffer.from(value, 'utf8'));

const ENTRY_TYPES = new Set<SandboxEntryType>(['directory', 'file', 'other', 'symlink']);

const toEntry = (info: ExecdFileInfo): SandboxEntry => ({
  mode: info.mode,
  modifiedAt: info.modifiedAt,
  path: info.path,
  size: info.size,
  type: ENTRY_TYPES.has(info.type as SandboxEntryType) ? (info.type as SandboxEntryType) : 'other',
});

const isHttpStatus = (error: unknown, ...statuses: number[]) =>
  error instanceof OpenSandboxHttpError && statuses.includes(error.status);

/**
 * One OpenSandbox sandbox, reached through its execd endpoint, for the
 * length of a `withWorkspace` task. Lifecycle (create, reuse, park, delete)
 * stays with the provider.
 */
export class OpenSandboxWorkspace implements SandboxWorkspace {
  readonly workdir = OPENSANDBOX_WORKDIR;
  phase: WorkspacePhase = 'run';
  readonly stats: WorkspaceStats = { fileInCount: 0, fileOutCount: 0, stdoutChars: 0 };
  private syncedIds?: Set<string>;

  constructor(
    private readonly client: OpenSandboxClient,
    private readonly execd: ExecdEndpoint,
    readonly fresh: boolean,
    private readonly limits: WorkspaceLimits,
    private readonly signal?: AbortSignal,
  ) {}

  private stepSignal(ms = STEP_TIMEOUT_MS) {
    return combineSignals(AbortSignal.timeout(ms), this.signal);
  }

  async exec({
    command,
    cwd,
    timeoutMs,
  }: {
    command: string;
    cwd?: string;
    timeoutMs: number;
  }): Promise<SandboxCommandResult> {
    this.phase = 'run';
    const startedAt = Date.now();
    const result = await this.stream(command, cwd || this.workdir, timeoutMs);
    const durationMs = Date.now() - startedAt;
    const timedOut = result.killed && durationMs >= timeoutMs;
    this.stats.exitCode = result.exitCode;
    this.stats.stdoutChars += result.stdoutChars;
    this.stats.timedOut = timedOut;
    return {
      durationMs,
      exitCode: result.exitCode,
      killed: result.killed && !timedOut,
      stderr: result.stderr,
      stdout: result.stdout,
      timedOut,
    };
  }

  async startBackground({ command, cwd }: { command: string; cwd?: string }) {
    this.phase = 'command';
    let id: string | undefined;
    let failure: string | undefined;
    const events = this.client.runCommand(
      this.execd,
      { background: true, command, cwd: cwd || this.workdir },
      this.stepSignal(),
    );
    for await (const event of events) {
      if (event.type === 'init' && event.text) id = event.text;
      if (event.type === 'error') {
        failure = `${event.error?.ename ?? 'Error'}: ${String(event.error?.evalue ?? '').trim()}`;
      }
      if (event.type === 'execution_complete' || event.type === 'error') break;
    }
    if (failure) throw new SandboxRequestError(`The command did not start. ${failure}`);
    if (!id) throw new SandboxError('ExecutionFailed', 'OpenSandbox returned no command id.');
    return id;
  }

  async commandStatus(id: string): Promise<SandboxCommandStatus> {
    this.phase = 'command';
    try {
      return await this.client.getCommandStatus(this.execd, id, this.stepSignal());
    } catch (error) {
      if (isHttpStatus(error, 400, 404)) throw this.unknownCommand(id);
      throw error;
    }
  }

  async commandLogs(id: string, cursor?: number): Promise<SandboxCommandLogs> {
    this.phase = 'command';
    const output = new OutputCollector(this.limits.maxOutputChars);
    try {
      const next = await this.client.getCommandLogs(this.execd, id, cursor, this.stepSignal(), (text) =>
        output.append(text),
      );
      return { cursor: next.cursor, output: output.toString() };
    } catch (error) {
      if (isHttpStatus(error, 400, 404)) throw this.unknownCommand(id);
      throw error;
    }
  }

  async interrupt(id: string) {
    this.phase = 'command';
    try {
      await this.client.interruptCommand(this.execd, id, this.stepSignal());
    } catch (error) {
      // execd answers 500 for an id that is unknown or already finished.
      if (isHttpStatus(error, 400, 404, 500)) {
        throw new SandboxRequestError(`Command ${id} is not running in this sandbox.`);
      }
      throw error;
    }
  }

  async fileInfo(path: string): Promise<SandboxEntry | undefined> {
    this.phase = 'files';
    const info = await this.client.getFileInfo(this.execd, path, this.stepSignal());
    return info ? toEntry(info) : undefined;
  }

  async readFile(path: string, maxBytes: number) {
    const info = await this.fileInfo(path);
    if (!info) throw new SandboxRequestError(`File not found: ${path}`);
    if (info.type === 'directory') {
      throw new SandboxRequestError(`${path} is a directory. Use listFiles to see its contents.`);
    }
    if (info.size > maxBytes) {
      throw new SandboxRequestError(
        `${path} is ${info.size} bytes, over the ${maxBytes}-byte limit. Read part of it with runCommand (head, tail, sed -n).`,
      );
    }
    this.phase = 'files';
    return this.client.downloadFile(this.execd, path, this.stepSignal(), maxBytes);
  }

  async writeFile(path: string, content: Uint8Array, mode?: number) {
    const info = await this.fileInfo(path);
    if (info?.type === 'directory') throw new SandboxRequestError(`${path} is a directory.`);
    this.phase = 'files';
    // Keep an existing file's permissions, e.g. an executable script.
    await this.client.uploadFiles(
      this.execd,
      [{ content, mode: mode ?? info?.mode ?? 644, path }],
      this.stepSignal(),
    );
  }

  async listDirectory(path: string, depth: number) {
    this.phase = 'files';
    try {
      const entries = await this.client.listDirectory(this.execd, path, depth, this.stepSignal());
      return entries.map(toEntry);
    } catch (error) {
      if (isHttpStatus(error, 400, 404)) {
        throw new SandboxRequestError(`Directory not found or not a directory: ${path}`);
      }
      throw error;
    }
  }

  async syncInputs(inputs: SandboxInputRef[]) {
    this.phase = 'upload';
    const { uploads } = await this.prepareInputs(inputs);
    if (uploads.length > 0) {
      await this.client.uploadFiles(this.execd, uploads, this.stepSignal());
    }
  }

  async markSynced(ids: string[]) {
    if (ids.length === 0) return;
    try {
      const synced = await this.readSynced();
      for (const id of ids) synced.add(id);
      this.phase = 'upload';
      await this.client.uploadFiles(
        this.execd,
        [{ content: utf8(JSON.stringify([...synced])), path: SYNCED_PATH }],
        this.stepSignal(),
      );
    } catch (error) {
      // Best effort: without the record, a later call uploads the same bytes again.
      logGenerationDebugSafe('sandbox_sync_record_failed', {
        errorKind: error instanceof Error ? error.name : 'unknown',
        httpStatus: error instanceof OpenSandboxHttpError ? error.status : undefined,
        provider: 'opensandbox',
      });
    }
  }

  /**
   * Python in a fresh process through the runner. Files the run creates or
   * changes at the top level of the workdir come back as outputs.
   */
  async runPython({
    code,
    inputs,
    timeoutMs,
  }: {
    code: string;
    inputs: SandboxInputRef[];
    timeoutMs: number;
  }): Promise<SandboxPythonResult> {
    this.phase = 'upload';
    const prepared = await this.prepareInputs(inputs);
    await this.client.uploadFiles(
      this.execd,
      [
        { content: utf8(buildRunnerScript()), path: RUNNER_PATH },
        { content: utf8(code), path: USER_CODE_PATH },
        // Drop the previous run's manifest before the process starts. An
        // abrupt exit never rewrites it, and collection must not republish
        // that run's files.
        { content: utf8('[]'), path: MANIFEST_PATH },
        ...prepared.uploads,
      ],
      this.stepSignal(),
    );

    this.phase = 'run';
    const startedAt = Date.now();
    const command = await this.stream(RUN_COMMAND, this.workdir, timeoutMs);
    if (command.killed && Date.now() - startedAt >= timeoutMs) {
      throw new SandboxError('Timeout', `Sandbox timed out after ${timeoutMs}ms.`);
    }

    this.phase = 'collect';
    const files = await this.collectOutputs(prepared.hashes);
    const killedNote = command.killed
      ? 'Process was killed before it finished (it may have run out of memory).'
      : '';
    this.stats.exitCode = command.exitCode;
    this.stats.fileOutCount += files.length;
    this.stats.stdoutChars += command.stdoutChars;
    return {
      exitCode: command.exitCode,
      files,
      stderr: [command.stderr, killedNote].filter(Boolean).join('\n'),
      stdout: command.stdout,
      success: command.exitCode === 0,
    };
  }

  private unknownCommand(id: string) {
    return new SandboxRequestError(
      `No background command ${id} in this sandbox. Its sandbox may have been replaced.`,
    );
  }

  private async readSynced() {
    if (this.syncedIds) return this.syncedIds;
    let ids = new Set<string>();
    // A sandbox created by this call holds no conversation files yet.
    if (!this.fresh) {
      try {
        const raw = await this.client.downloadFile(
          this.execd,
          SYNCED_PATH,
          this.stepSignal(),
          SYNCED_MAX_BYTES,
        );
        const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as unknown;
        if (Array.isArray(parsed)) {
          ids = new Set(parsed.filter((item): item is string => typeof item === 'string'));
        }
      } catch {
        // Missing or unreadable record: treat every input as new.
      }
    }
    this.syncedIds = ids;
    return ids;
  }

  /**
   * Picks the conversation files this sandbox does not have yet, newest
   * first, one per basename. A file the sandbox already received is not sent
   * again, so edits made in the sandbox survive later calls.
   */
  private async prepareInputs(inputs: SandboxInputRef[]) {
    const hashes = new Map<string, string>();
    const uploads: Array<{ content: Uint8Array; path: string }> = [];
    if (inputs.length === 0) return { hashes, uploads };

    const synced = await this.readSynced();
    const names = new Set<string>();
    const added: string[] = [];
    for (const input of inputs) {
      const name = safeBasename(input.filename);
      if (!name || name === CONTROL_NAME || names.has(name)) continue;
      names.add(name);
      if (synced.has(input.id)) continue;
      let content: Uint8Array | undefined;
      try {
        content = await input.load();
      } catch {
        continue;
      }
      if (!content || content.byteLength === 0 || content.byteLength > this.limits.maxFileBytes) {
        continue;
      }
      hashes.set(name, sha256Hex(content));
      uploads.push({ content, path: `${this.workdir}/${name}` });
      added.push(input.id);
    }
    if (added.length > 0) {
      for (const id of added) synced.add(id);
      uploads.push({ content: utf8(JSON.stringify([...synced])), path: SYNCED_PATH });
    }
    this.stats.fileInCount += added.length;
    return { hashes, uploads };
  }

  private async stream(command: string, cwd: string, timeoutMs: number): Promise<StreamResult> {
    const stdout = new OutputCollector(this.limits.maxOutputChars);
    const stderr = new OutputCollector(this.limits.maxOutputChars);
    const result: Pick<StreamResult, 'exitCode' | 'killed'> = { killed: false };
    let commandId: string | undefined;
    let settled = false;

    try {
      const events = this.client.runCommand(
        this.execd,
        { command, cwd, timeoutMs },
        combineSignals(AbortSignal.timeout(timeoutMs + RUN_ABORT_GRACE_MS), this.signal),
      );
      for await (const event of events) {
        switch (event.type) {
          case 'init': {
            commandId = event.text || commandId;
            break;
          }
          case 'stdout': {
            stdout.push(event.text ?? '');
            break;
          }
          case 'stderr': {
            stderr.push(event.text ?? '');
            break;
          }
          case 'execution_complete': {
            result.exitCode = 0;
            settled = true;
            break;
          }
          case 'error': {
            const evalue = String(event.error?.evalue ?? '').trim();
            const exitCode = Number.parseInt(evalue, 10);
            if (evalue === KILLED_EXIT) {
              result.killed = true;
            } else if (Number.isInteger(exitCode)) {
              result.exitCode = exitCode;
            } else {
              stderr.push(`${event.error?.ename ?? 'Error'}: ${evalue}`);
            }
            settled = true;
            break;
          }
        }
      }
    } catch (error) {
      // The caller stopped: do not leave the process running in the sandbox.
      if (this.signal?.aborted && commandId) {
        await this.client
          .interruptCommand(this.execd, commandId, AbortSignal.timeout(INTERRUPT_TIMEOUT_MS))
          .catch(() => undefined);
      }
      throw error;
    }

    if (!settled) {
      throw new SandboxError('ExecutionFailed', 'OpenSandbox ended the run without a result.');
    }
    return {
      ...result,
      stderr: stderr.toString(),
      stdout: stdout.toString(),
      stdoutChars: stdout.length,
    };
  }

  /**
   * Best effort: a missing manifest (the process was killed, or the code
   * replaced the runner's exit path) or a failed download keeps
   * stdout/stderr and returns no files.
   */
  private async collectOutputs(inputHashes: Map<string, string>): Promise<SandboxFile[]> {
    try {
      const manifest = await this.client.downloadFile(
        this.execd,
        MANIFEST_PATH,
        this.stepSignal(),
        OPENSANDBOX_MANIFEST_MAX_BYTES,
      );
      const files: SandboxFile[] = [];
      for (const entry of parseOutputManifest(Buffer.from(manifest).toString('utf8'))) {
        if (files.length >= this.limits.maxFileCount) break;
        const name = safeBasename(entry.name);
        if (!name || name !== entry.name) continue;
        if (!entry.changed) continue;
        if (entry.size <= 0 || entry.size > this.limits.maxFileBytes) continue;
        if (inputHashes.get(name) === entry.sha256) continue;
        const content = await this.client.downloadFile(
          this.execd,
          `${this.workdir}/${name}`,
          this.stepSignal(),
          this.limits.maxFileBytes,
        );
        if (content.byteLength === 0 || content.byteLength > this.limits.maxFileBytes) continue;
        files.push({ content, filename: name });
      }
      return files;
    } catch (error) {
      logGenerationDebugSafe('sandbox_collect_failed', {
        errorKind: error instanceof Error ? error.name : 'unknown',
        httpStatus: error instanceof OpenSandboxHttpError ? error.status : undefined,
        provider: 'opensandbox',
      });
      return [];
    }
  }
}
