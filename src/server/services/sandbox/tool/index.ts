import { posix } from 'node:path';

import type { LobeChatDatabase } from '@lobechat/database';
import type { CodeInterpreterResponse, SandboxToolResult } from '@lobechat/types';

import { sandboxEnv } from '@/envs/sandbox';
import {
  SANDBOX_CONTROL_DIR,
  SandboxApiName,
  resolveSandboxApiName,
} from '@/tools/sandbox/const';

import { listConversationSandboxInputs, persistSandboxOutputFiles } from '../conversationFiles';
import { getSandboxProvider } from '../registry';
import { buildSandboxSessionKey, type SandboxConversationScope } from '../session';
import {
  SandboxError,
  type SandboxFile,
  type SandboxInputRef,
  type SandboxProvider,
  SandboxRequestError,
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
  'Background commands need a sandbox that stays alive between calls, but this deployment starts a fresh sandbox for every call (OPENSANDBOX_SESSION_IDLE_TIMEOUT=0). Run the command in the foreground instead.';

export interface InvokeSandboxToolParams extends SandboxConversationScope {
  apiName: string;
  args: Record<string, unknown>;
  db: LobeChatDatabase;
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
  private readonly maxFileBytes = sandboxEnv.SANDBOX_MAX_FILE_BYTES;
  private readonly maxFileCount = sandboxEnv.SANDBOX_MAX_FILE_COUNT;
  private readonly provider: SandboxProvider = getSandboxProvider();
  private readonly sessionKey: string;

  constructor(private readonly params: InvokeSandboxToolParams) {
    this.sessionKey = buildSandboxSessionKey(params);
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

  async runPython({ code, timeout }: SandboxToolArgs['runPython']): Promise<SandboxToolResult> {
    if (!code.trim()) return pythonFailure('runPython received empty code.');
    const timeoutMs = this.timeoutMs(timeout);
    const inputs = await this.inputs();
    return this.use(SandboxApiName.runPython, timeoutMs, async (workspace) => {
      const result = await workspace.runPython({ code, inputs, timeoutMs });
      const persisted = await this.persist(workspace, result.files);
      return {
        files: persisted.length > 0 ? persisted : undefined,
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

  exportFile({ paths }: SandboxToolArgs['exportFile']) {
    const unique = [...new Set(paths)].slice(0, this.maxFileCount);
    return this.useWithInputs(SandboxApiName.exportFile, FILE_BUDGET_MS, async (workspace) => {
      const files: SandboxFile[] = [];
      const skipped: string[] = [];
      for (const path of unique) {
        const resolved = this.resolvePath(workspace, path);
        try {
          const content = await workspace.readFile(resolved, this.maxFileBytes);
          if (content.byteLength === 0) {
            skipped.push(`${path}: the file is empty`);
            continue;
          }
          files.push({ content, filename: posix.basename(resolved) });
        } catch (error) {
          if (!(error instanceof SandboxRequestError)) throw error;
          skipped.push(`${path}: ${error.message}`);
        }
      }
      const persisted = files.length > 0 ? await this.persist(workspace, files) : [];
      if (persisted.length < files.length) {
        skipped.push(`${files.length - persisted.length} file(s) could not be stored`);
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

/**
 * Runs one Sandbox tool call for a conversation and returns the result the
 * model sees (serialized as the tool message content). Failures come back as
 * `success: false` results, never as exceptions.
 */
export const invokeSandboxTool = async (
  params: InvokeSandboxToolParams,
): Promise<SandboxToolResult> => {
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

  const runner = new SandboxToolRunner(params);
  try {
    // The schema for each API name produces that API's arguments.
    const call = runner[apiName].bind(runner) as (args: unknown) => Promise<SandboxToolResult>;
    return await call(parsed.data);
  } catch (error) {
    const message =
      error instanceof SandboxError || error instanceof Error ? error.message : 'Sandbox failed.';
    return isPython ? pythonFailure(message) : failure(message);
  }
};
