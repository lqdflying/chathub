import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { codeInterpreterEnv } from '@/envs/codeInterpreter';
import { logGenerationDebugSafe } from '@/libs/logger/generationDebug';

import {
  SandboxError,
  type SandboxFile,
  type SandboxOutcome,
  type SandboxProvider,
  type SandboxRunInput,
  type SandboxRunResult,
} from '../../types';
import {
  type ExecdEndpoint,
  OPENSANDBOX_MANIFEST_MAX_BYTES,
  OpenSandboxClient,
  OpenSandboxHttpError,
  type OpenSandboxNetworkPolicy,
} from './client';
import {
  buildRunnerScript,
  MANIFEST_PATH,
  OPENSANDBOX_WORKDIR,
  parseOutputManifest,
  RUN_COMMAND,
  RUNNER_PATH,
  USER_CODE_PATH,
} from './python';

// Keeps the container alive; execd (injected by the server) does the work.
// `tail` exists in every Debian/Ubuntu/Alpine-based Python image.
export const SANDBOX_ENTRYPOINT = ['tail', '-f', '/dev/null'];

const STATE_POLL_MS = 250;
const STEP_TIMEOUT_MS = 30_000;
const DELETE_TIMEOUT_MS = 10_000;
// execd kills the process at the run timeout; the client waits a little
// longer so the kill is reported instead of racing an abort.
const RUN_ABORT_GRACE_MS = 5000;
// Server-side TTL on top of the run budget, so a sandbox ChatHub failed to
// delete (crash, network loss) is still reaped.
const TTL_MARGIN_SECONDS = 120;
const MIN_TTL_SECONDS = 60;
const FAILED_STATES = new Set(['Failed', 'Stopping', 'Terminated']);
// Container label (OpenSandbox metadata) that ties a sandbox to one
// conversation scope. The value is the hashed `sessionKey`.
export const SESSION_METADATA_KEY = 'chathub-session';
// A reused sandbox that does not answer quickly is treated as gone.
const REUSE_PING_TIMEOUT_MS = 5000;
// execd reports a signal death as exit "-1" with "signal: killed".
const KILLED_EXIT = '-1';

type RunPhase = 'collect' | 'ready' | 'run' | 'upload';

interface CommandResult {
  exitCode?: number;
  killed: boolean;
  stderr: string;
  stdout: string;
}

const truncateChars = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n…[output truncated]`;
};

const safeBasename = (filename: string) => {
  const name = filename.replaceAll('\\', '/').split('/').pop() ?? '';
  if (!name || name === '.' || name === '..') return undefined;
  return name;
};

const sha256Hex = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');

const utf8 = (value: string) => new Uint8Array(Buffer.from(value, 'utf8'));

const isAbortError = (error: unknown) =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

// Runs that share a session sandbox take turns inside this process, so two
// tool calls in one turn neither race the lookup nor share the workdir.
const sessionQueues = new Map<string, Promise<unknown>>();

const withSessionLock = async <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const previous = sessionQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  sessionQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (sessionQueues.get(key) === current) sessionQueues.delete(key);
  }
};

export const buildNetworkPolicy = (
  enableNetwork: boolean | undefined,
  allowList: string[],
): OpenSandboxNetworkPolicy | undefined => {
  if (enableNetwork === false) return { defaultAction: 'deny', egress: [] };
  if (allowList.length === 0) return undefined;
  return {
    defaultAction: 'deny',
    egress: allowList.map((target) => ({ action: 'allow', target })),
  };
};

export class OpenSandboxProvider implements SandboxProvider {
  readonly id = 'opensandbox';
  private apiKey?: string;
  private baseUrl?: string;
  private cpu: string;
  private egressAllow: string[];
  private image?: string;
  private maxFileBytes: number;
  private maxFileCount: number;
  private maxStdoutChars: number;
  private memory: string;
  private readyTimeout: number;
  private sessionIdleTimeout: number;
  private sessionMaxLifetime: number;
  private timeout: number;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    image?: string;
    sessionIdleTimeout?: number;
    sessionMaxLifetime?: number;
  }) {
    this.baseUrl = (options?.baseUrl ?? codeInterpreterEnv.OPENSANDBOX_SERVER_URL)?.replace(
      /\/+$/,
      '',
    );
    this.apiKey = options?.apiKey ?? codeInterpreterEnv.OPENSANDBOX_API_KEY;
    this.image = (options?.image ?? codeInterpreterEnv.OPENSANDBOX_IMAGE)?.trim() || undefined;
    this.cpu = codeInterpreterEnv.OPENSANDBOX_CPU;
    this.egressAllow = (codeInterpreterEnv.OPENSANDBOX_EGRESS_ALLOW ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    this.memory = codeInterpreterEnv.OPENSANDBOX_MEMORY;
    this.readyTimeout = codeInterpreterEnv.OPENSANDBOX_READY_TIMEOUT;
    this.sessionIdleTimeout =
      options?.sessionIdleTimeout ?? codeInterpreterEnv.OPENSANDBOX_SESSION_IDLE_TIMEOUT;
    this.sessionMaxLifetime =
      options?.sessionMaxLifetime ?? codeInterpreterEnv.OPENSANDBOX_SESSION_MAX_LIFETIME;
    this.timeout = codeInterpreterEnv.CODE_INTERPRETER_TIMEOUT;
    this.maxFileBytes = codeInterpreterEnv.CODE_INTERPRETER_MAX_FILE_BYTES;
    this.maxFileCount = codeInterpreterEnv.CODE_INTERPRETER_MAX_FILE_COUNT;
    this.maxStdoutChars = codeInterpreterEnv.CODE_INTERPRETER_MAX_STDOUT_CHARS;
  }

  isConfigured() {
    return !!this.baseUrl && !!this.image;
  }

  /**
   * With a `sessionKey` and a non-zero idle timeout, runs in one conversation
   * share a sandbox: installs, files, and background processes carry over, and
   * the sandbox is removed only after the idle timeout without a run. Python
   * variables do not carry over: every run is a new process. An optional max
   * lifetime replaces a sandbox once it reaches that age.
   */
  async run(input: SandboxRunInput): Promise<SandboxRunResult> {
    const sessionKey = this.sessionIdleTimeout > 0 ? input.sessionKey : undefined;
    if (!sessionKey) return this.runOnce(input);
    return withSessionLock(sessionKey, () => this.runOnce(input, sessionKey));
  }

  private async runOnce(input: SandboxRunInput, sessionKey?: string): Promise<SandboxRunResult> {
    const startedAt = Date.now();
    const timeoutMs = input.timeoutMs ?? this.timeout;
    const baseFields = {
      fileInCount: input.files.length,
      operationHash: input.operationHash,
      packageCount: input.packageCount ?? 0,
      provider: this.id,
      sessionScoped: !!sessionKey,
      timeoutMs,
    };
    const settle = (fields: Record<string, unknown>) =>
      logGenerationDebugSafe('sandbox_run_settled', {
        ...baseFields,
        durationMs: Date.now() - startedAt,
        fileOutCount: 0,
        stdoutChars: 0,
        ...fields,
      });

    logGenerationDebugSafe('sandbox_run_started', baseFields);

    if (!this.baseUrl || !this.image) {
      settle({ outcome: 'not_configured' });
      throw new SandboxError(
        'NotConfigured',
        'OPENSANDBOX_SERVER_URL and OPENSANDBOX_IMAGE must both be set',
      );
    }

    if (input.language !== 'python3') {
      throw new SandboxError('ExecutionFailed', 'OpenSandbox provider only supports python3.');
    }

    const client = new OpenSandboxClient({ apiKey: this.apiKey, baseUrl: this.baseUrl });
    let phase: RunPhase = 'ready';
    // Room a session sandbox needs before its retire time to host one run.
    const runBudgetMs = timeoutMs + TTL_MARGIN_SECONDS * 1000;
    let sandboxId: string | undefined;
    let retireAt = 0;
    let keepSandbox = false;
    let reused = false;
    let retired = false;
    let lookupFailed = false;

    try {
      const readySignal = AbortSignal.timeout(this.readyTimeout);
      const lookup = sessionKey
        ? await this.reuseSandbox(client, sessionKey, runBudgetMs, readySignal)
        : undefined;
      retired = !!lookup?.retired;
      lookupFailed = !!lookup?.lookupFailed;
      let execd: ExecdEndpoint;
      let createdAt: number | undefined;
      if (lookup?.sandbox) {
        ({ createdAt, execd, id: sandboxId } = lookup.sandbox);
        reused = true;
      } else {
        ({ createdAt, execd, id: sandboxId } = await this.createSandbox(
          client,
          input,
          timeoutMs,
          sessionKey,
          readySignal,
        ));
      }
      retireAt = this.retireAt(createdAt);

      phase = 'upload';
      const inputHashes = new Map<string, string>();
      const uploads: Array<{ content: Uint8Array; path: string }> = [
        { content: utf8(buildRunnerScript()), path: RUNNER_PATH },
        { content: utf8(input.code), path: USER_CODE_PATH },
      ];
      for (const file of input.files) {
        const name = safeBasename(file.filename);
        if (!name || inputHashes.has(name) || file.content.byteLength > this.maxFileBytes) continue;
        inputHashes.set(name, sha256Hex(file.content));
        uploads.push({ content: file.content, path: `${OPENSANDBOX_WORKDIR}/${name}` });
      }
      await client.uploadFiles(execd, uploads, AbortSignal.timeout(STEP_TIMEOUT_MS));

      phase = 'run';
      const runStartedAt = Date.now();
      const command = await this.runCommand(client, execd, timeoutMs);
      if (command.killed && Date.now() - runStartedAt >= timeoutMs) {
        throw new SandboxError('Timeout', `Code Interpreter sandbox timed out after ${timeoutMs}ms.`);
      }

      phase = 'collect';
      const files = await this.collectOutputs(client, execd, inputHashes);

      const success = command.exitCode === 0;
      const killedNote = command.killed
        ? 'Process was killed before it finished (it may have run out of memory).'
        : '';
      const stderr = truncateChars(
        [command.stderr, killedNote].filter(Boolean).join('\n'),
        this.maxStdoutChars,
      );
      const stdout = truncateChars(command.stdout, this.maxStdoutChars);
      const outcome: SandboxOutcome = success ? 'ok' : 'error';
      const durationMs = Date.now() - startedAt;

      // A failing script is still a healthy sandbox worth keeping.
      keepSandbox = !!sessionKey;
      settle({
        exitCode: command.exitCode,
        fileOutCount: files.length,
        outcome,
        sandboxLookupFailed: lookupFailed,
        sandboxRetired: retired,
        sandboxReused: reused,
        stdoutChars: stdout.length,
      });

      return { durationMs, exitCode: command.exitCode, files, outcome, stderr, stdout, success };
    } catch (error) {
      const classified = this.classifyError(error, phase, timeoutMs);
      // execd killed the process at the timeout; the sandbox itself is fine.
      // Any other failure may mean a broken sandbox, so the next run starts fresh.
      keepSandbox = !!sessionKey && classified.code === 'Timeout';
      settle({
        errorKind: classified.code,
        failurePhase: phase,
        httpStatus: classified.httpStatus,
        outcome: classified.outcome,
        sandboxLookupFailed: lookupFailed,
        sandboxRetired: retired,
        sandboxReused: reused,
      });
      throw classified;
    } finally {
      if (sandboxId) {
        if (keepSandbox) await this.parkSandbox(client, sandboxId, retireAt, runBudgetMs);
        else await this.deleteQuietly(client, sandboxId);
      }
    }
  }

  private async createSandbox(
    client: OpenSandboxClient,
    input: SandboxRunInput,
    timeoutMs: number,
    sessionKey: string | undefined,
    signal: AbortSignal,
  ) {
    const requestedAt = Date.now();
    const created = await client.createSandbox(
      {
        entrypoint: SANDBOX_ENTRYPOINT,
        image: { uri: this.image! },
        metadata: {
          name: 'chathub-code-interpreter',
          ...(sessionKey ? { [SESSION_METADATA_KEY]: sessionKey } : {}),
        },
        networkPolicy: buildNetworkPolicy(input.enableNetwork, this.egressAllow),
        resourceLimits: { cpu: this.cpu, memory: this.memory },
        // Covers this run only. A session sandbox is extended by the idle
        // timeout after each run, so a crash mid-run still frees it soon.
        timeout: Math.max(
          MIN_TTL_SECONDS,
          Math.ceil((this.readyTimeout + timeoutMs) / 1000) + TTL_MARGIN_SECONDS,
        ),
      },
      signal,
    );
    try {
      await this.waitUntilRunning(client, created.id, created.state, signal);
      const execd = await client.getExecdEndpoint(created.id, signal);
      await this.waitForExecd(client, execd, signal);
      return { createdAt: created.createdAt ?? requestedAt, execd, id: created.id };
    } catch (error) {
      // The caller never learns the id, so the sandbox is removed here.
      await this.deleteQuietly(client, created.id);
      throw error;
    }
  }

  /**
   * Finds this conversation's running sandbox and pushes its expiry past the
   * coming run. One that does not respond, or is too close to its optional max
   * lifetime to finish the run, is deleted, and the caller creates a fresh
   * one. So does a failed lookup: reuse must never be why a run fails.
   */
  private async reuseSandbox(
    client: OpenSandboxClient,
    sessionKey: string,
    runBudgetMs: number,
    signal: AbortSignal,
  ): Promise<{
    lookupFailed?: boolean;
    retired: boolean;
    sandbox?: { createdAt?: number; execd: ExecdEndpoint; id: string };
  }> {
    let found: Awaited<ReturnType<OpenSandboxClient['findRunningSandboxes']>>;
    try {
      found = await client.findRunningSandboxes({ [SESSION_METADATA_KEY]: sessionKey }, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      return { lookupFailed: true, retired: false };
    }
    let retired = false;
    for (const { createdAt, id } of found) {
      if (this.retireAt(createdAt) - Date.now() < runBudgetMs) {
        retired = true;
        await this.deleteQuietly(client, id);
        continue;
      }
      try {
        await client.renewExpiration(id, new Date(Date.now() + runBudgetMs), signal);
        const execd = await client.getExecdEndpoint(id, signal);
        if (await client.pingExecd(execd, AbortSignal.timeout(REUSE_PING_TIMEOUT_MS))) {
          return { retired, sandbox: { createdAt, execd, id } };
        }
      } catch (error) {
        if (signal.aborted) throw error;
      }
      await this.deleteQuietly(client, id);
    }
    return { retired };
  }

  /** When the optional age cap is on, the time a sandbox stops being reused. */
  private retireAt(createdAt: number | undefined) {
    if (this.sessionMaxLifetime <= 0) return Number.POSITIVE_INFINITY;
    // Without a creation time the cap cannot be enforced.
    return (createdAt ?? Number.NEGATIVE_INFINITY) + this.sessionMaxLifetime;
  }

  private async waitUntilRunning(
    client: OpenSandboxClient,
    sandboxId: string,
    initialState: string | undefined,
    signal: AbortSignal,
  ) {
    let state = initialState;
    let message: string | undefined;
    while (state !== 'Running') {
      if (state && FAILED_STATES.has(state)) {
        throw new SandboxError(
          'Unavailable',
          `OpenSandbox sandbox failed to start (${state}${message ? `: ${message}` : ''}).`,
        );
      }
      await sleep(STATE_POLL_MS, undefined, { signal });
      ({ message, state } = await client.getSandboxStatus(sandboxId, signal));
    }
  }

  /**
   * `Running` means the container started, not that execd listens: the
   * server proxy answers 502 until it does.
   */
  private async waitForExecd(
    client: OpenSandboxClient,
    execd: ExecdEndpoint,
    signal: AbortSignal,
  ) {
    for (;;) {
      try {
        if (await client.pingExecd(execd, signal)) return;
      } catch (error) {
        if (signal.aborted) throw error;
      }
      await sleep(STATE_POLL_MS, undefined, { signal });
    }
  }

  private async runCommand(
    client: OpenSandboxClient,
    execd: ExecdEndpoint,
    timeoutMs: number,
  ): Promise<CommandResult> {
    // Keep one char past the cap so truncateChars still marks the cut.
    const cap = this.maxStdoutChars + 1;
    const lines = { stderr: [] as string[], stdout: [] as string[] };
    const sizes = { stderr: 0, stdout: 0 };
    const result: Omit<CommandResult, 'stderr' | 'stdout'> = { killed: false };
    let settled = false;

    const events = client.runCommand(
      execd,
      { command: RUN_COMMAND, cwd: OPENSANDBOX_WORKDIR, timeoutMs },
      AbortSignal.timeout(timeoutMs + RUN_ABORT_GRACE_MS),
    );
    for await (const event of events) {
      switch (event.type) {
        case 'stdout':
        case 'stderr': {
          const text = event.text ?? '';
          if (sizes[event.type] < cap) {
            lines[event.type].push(text);
            sizes[event.type] += text.length + 1;
          }
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
            lines.stderr.push(`${event.error?.ename ?? 'Error'}: ${evalue}`);
          }
          settled = true;
          break;
        }
      }
    }

    if (!settled) {
      throw new SandboxError('ExecutionFailed', 'OpenSandbox ended the run without a result.');
    }
    return {
      ...result,
      stderr: lines.stderr.join('\n').slice(0, cap),
      stdout: lines.stdout.join('\n').slice(0, cap),
    };
  }

  /**
   * Best effort: a missing manifest (the process was killed, or the code
   * replaced the runner's exit path) or a failed download keeps
   * stdout/stderr and returns no files.
   */
  private async collectOutputs(
    client: OpenSandboxClient,
    execd: ExecdEndpoint,
    inputHashes: Map<string, string>,
  ): Promise<SandboxFile[]> {
    try {
      const manifest = await client.downloadFile(
        execd,
        MANIFEST_PATH,
        AbortSignal.timeout(STEP_TIMEOUT_MS),
        OPENSANDBOX_MANIFEST_MAX_BYTES,
      );
      const files: SandboxFile[] = [];
      for (const entry of parseOutputManifest(Buffer.from(manifest).toString('utf8'))) {
        if (files.length >= this.maxFileCount) break;
        const name = safeBasename(entry.name);
        if (!name || name !== entry.name) continue;
        if (!entry.changed) continue;
        if (entry.size <= 0 || entry.size > this.maxFileBytes) continue;
        if (inputHashes.get(name) === entry.sha256) continue;
        const content = await client.downloadFile(
          execd,
          `${OPENSANDBOX_WORKDIR}/${name}`,
          AbortSignal.timeout(STEP_TIMEOUT_MS),
          this.maxFileBytes,
        );
        if (content.byteLength === 0 || content.byteLength > this.maxFileBytes) continue;
        files.push({ content, filename: name });
      }
      return files;
    } catch (error) {
      logGenerationDebugSafe('sandbox_collect_failed', {
        errorKind: error instanceof Error ? error.name : 'unknown',
        httpStatus: error instanceof OpenSandboxHttpError ? error.status : undefined,
        provider: this.id,
      });
      return [];
    }
  }

  /**
   * Keeps a session sandbox for the idle timeout, and with an age cap never
   * past its retire time; one too close to that to host another run is
   * deleted now. Best effort: if the renew fails, the sandbox still expires at
   * its earlier deadline.
   */
  private async parkSandbox(
    client: OpenSandboxClient,
    sandboxId: string,
    retireAt: number,
    runBudgetMs: number,
  ) {
    const now = Date.now();
    if (retireAt - now < runBudgetMs) return this.deleteQuietly(client, sandboxId);
    try {
      await client.renewExpiration(
        sandboxId,
        new Date(Math.min(now + this.sessionIdleTimeout, retireAt)),
        AbortSignal.timeout(DELETE_TIMEOUT_MS),
      );
    } catch (error) {
      logGenerationDebugSafe('sandbox_cleanup_failed', {
        errorKind: error instanceof Error ? error.name : 'unknown',
        httpStatus: error instanceof OpenSandboxHttpError ? error.status : undefined,
        operation: 'renew',
        provider: this.id,
      });
    }
  }

  private async deleteQuietly(client: OpenSandboxClient, sandboxId: string) {
    try {
      await client.deleteSandbox(sandboxId, AbortSignal.timeout(DELETE_TIMEOUT_MS));
    } catch (error) {
      // The server-side TTL still reaps it.
      logGenerationDebugSafe('sandbox_cleanup_failed', {
        errorKind: error instanceof Error ? error.name : 'unknown',
        httpStatus: error instanceof OpenSandboxHttpError ? error.status : undefined,
        provider: this.id,
      });
    }
  }

  private classifyError(error: unknown, phase: RunPhase, timeoutMs: number): SandboxError {
    if (error instanceof SandboxError) return error;

    if (error instanceof OpenSandboxHttpError) {
      const httpStatus = error.status;
      if (httpStatus === 401 || httpStatus === 403) {
        return new SandboxError('Unauthorized', 'OpenSandbox server rejected the API key.', {
          httpStatus,
        });
      }
      if (httpStatus === 429 || httpStatus >= 500) {
        return new SandboxError('Unavailable', error.message, { httpStatus });
      }
      return new SandboxError('ExecutionFailed', error.message, { httpStatus });
    }

    if (isAbortError(error)) {
      if (phase === 'run') {
        return new SandboxError(
          'Timeout',
          `Code Interpreter sandbox timed out after ${timeoutMs}ms.`,
        );
      }
      if (phase === 'ready') {
        return new SandboxError(
          'Unavailable',
          `OpenSandbox sandbox was not ready within ${this.readyTimeout}ms.`,
        );
      }
      return new SandboxError('Unavailable', `OpenSandbox ${phase} step timed out.`);
    }

    // undici reports connection failures as `TypeError: fetch failed`.
    if (error instanceof TypeError) {
      return new SandboxError('Unavailable', 'OpenSandbox server is unreachable.');
    }
    return new SandboxError('ExecutionFailed', 'OpenSandbox returned an unexpected response.');
  }
}
