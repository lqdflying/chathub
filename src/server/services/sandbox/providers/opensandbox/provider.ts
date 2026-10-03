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
  private timeout: number;

  constructor(options?: { apiKey?: string; baseUrl?: string; image?: string }) {
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
    this.timeout = codeInterpreterEnv.CODE_INTERPRETER_TIMEOUT;
    this.maxFileBytes = codeInterpreterEnv.CODE_INTERPRETER_MAX_FILE_BYTES;
    this.maxFileCount = codeInterpreterEnv.CODE_INTERPRETER_MAX_FILE_COUNT;
    this.maxStdoutChars = codeInterpreterEnv.CODE_INTERPRETER_MAX_STDOUT_CHARS;
  }

  isConfigured() {
    return !!this.baseUrl && !!this.image;
  }

  async run(input: SandboxRunInput): Promise<SandboxRunResult> {
    const startedAt = Date.now();
    const timeoutMs = input.timeoutMs ?? this.timeout;
    const baseFields = {
      fileInCount: input.files.length,
      operationHash: input.operationHash,
      packageCount: input.packageCount ?? 0,
      provider: this.id,
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
    let sandboxId: string | undefined;

    try {
      const readySignal = AbortSignal.timeout(this.readyTimeout);
      const created = await client.createSandbox(
        {
          entrypoint: SANDBOX_ENTRYPOINT,
          image: { uri: this.image },
          metadata: { name: 'chathub-code-interpreter' },
          networkPolicy: buildNetworkPolicy(input.enableNetwork, this.egressAllow),
          resourceLimits: { cpu: this.cpu, memory: this.memory },
          timeout: Math.max(
            MIN_TTL_SECONDS,
            Math.ceil((this.readyTimeout + timeoutMs) / 1000) + TTL_MARGIN_SECONDS,
          ),
        },
        readySignal,
      );
      sandboxId = created.id;
      await this.waitUntilRunning(client, sandboxId, created.state, readySignal);
      const execd = await client.getExecdEndpoint(sandboxId, readySignal);
      await this.waitForExecd(client, execd, readySignal);

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

      settle({
        exitCode: command.exitCode,
        fileOutCount: files.length,
        outcome,
        stdoutChars: stdout.length,
      });

      return { durationMs, exitCode: command.exitCode, files, outcome, stderr, stdout, success };
    } catch (error) {
      const classified = this.classifyError(error, phase, timeoutMs);
      settle({
        errorKind: classified.code,
        failurePhase: phase,
        httpStatus: classified.httpStatus,
        outcome: classified.outcome,
      });
      throw classified;
    } finally {
      if (sandboxId) await this.deleteQuietly(client, sandboxId);
    }
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
