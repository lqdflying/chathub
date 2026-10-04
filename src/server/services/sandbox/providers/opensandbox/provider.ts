import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { sandboxEnv } from '@/envs/sandbox';
import { logGenerationDebugSafe } from '@/libs/logger/generationDebug';

import {
  SandboxError,
  type SandboxProvider,
  SandboxRequestError,
  type SandboxSessionOptions,
  type SandboxWorkspace,
} from '../../types';
import {
  type ExecdEndpoint,
  OpenSandboxClient,
  OpenSandboxHttpError,
  type OpenSandboxNetworkPolicy,
} from './client';
import { OPENSANDBOX_LAYOUT_VERSION } from './python';
import { combineSignals, OpenSandboxWorkspace, type WorkspacePhase } from './workspace';

// Keeps the container alive; execd (injected by the server) does the work.
// `tail` exists in every Debian/Ubuntu/Alpine-based image.
export const SANDBOX_ENTRYPOINT = ['tail', '-f', '/dev/null'];

const STATE_POLL_MS = 250;
const DELETE_TIMEOUT_MS = 10_000;
// Server-side TTL on top of the call budget, so a sandbox ChatHub failed to
// delete (crash, network loss) is still reaped.
const TTL_MARGIN_SECONDS = 120;
const MIN_TTL_SECONDS = 60;
const FAILED_STATES = new Set(['Failed', 'Stopping', 'Terminated']);
// Container label (OpenSandbox metadata) that ties a sandbox to one
// conversation scope. The value is the hashed `sessionKey`.
export const SESSION_METADATA_KEY = 'chathub-session';
// Container label recording the network policy this sandbox was created with.
// `open` means no policy. A reused sandbox with any other value, or with the
// label missing while a policy is now required, is replaced.
export const NETWORK_METADATA_KEY = 'chathub-network';
export const OPEN_NETWORK_FINGERPRINT = 'open';
// Container label recording the image and workspace layout. A parked sandbox
// whose label differs (or is missing) is replaced, so a new image or layout
// takes effect without waiting for old sandboxes to go idle.
export const RUNTIME_METADATA_KEY = 'chathub-runtime';
export const SANDBOX_METADATA_NAME = 'chathub-sandbox';
// A reused sandbox that does not answer quickly is treated as gone.
const REUSE_PING_TIMEOUT_MS = 5000;

// Calls that share a session sandbox take turns inside this process, so two
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

/** Stable label value for the policy `createSandbox` will send. */
export const networkPolicyFingerprint = (policy: OpenSandboxNetworkPolicy | undefined) => {
  if (!policy) return OPEN_NETWORK_FINGERPRINT;
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex').slice(0, 32);
};

/** Stable label value for the image and workspace layout a sandbox runs. */
export const runtimeFingerprint = (image: string) =>
  createHash('sha256')
    .update(JSON.stringify({ image, layout: OPENSANDBOX_LAYOUT_VERSION }))
    .digest('hex')
    .slice(0, 32);

const networkCompatible = (recorded: string | undefined, fingerprint: string) =>
  recorded === fingerprint || (!recorded && fingerprint === OPEN_NETWORK_FINGERPRINT);

/** A failure that leaves the sandbox healthy, so a session keeps it. */
const keepsSandbox = (error: SandboxError) =>
  error instanceof SandboxRequestError || error.code === 'Timeout' || error.code === 'Cancelled';

export class OpenSandboxProvider implements SandboxProvider {
  readonly id = 'opensandbox';
  private apiKey?: string;
  private baseUrl?: string;
  private cpu: string;
  private egressAllow: string[];
  private image?: string;
  private maxFileBytes: number;
  private maxFileCount: number;
  private maxOutputChars: number;
  private memory: string;
  private readyTimeout: number;
  private sessionIdleTimeout: number;
  private sessionMaxLifetime: number;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    image?: string;
    sessionIdleTimeout?: number;
    sessionMaxLifetime?: number;
  }) {
    this.baseUrl = (options?.baseUrl ?? sandboxEnv.OPENSANDBOX_SERVER_URL)?.replace(/\/+$/, '');
    this.apiKey = options?.apiKey ?? sandboxEnv.OPENSANDBOX_API_KEY;
    this.image = (options?.image ?? sandboxEnv.OPENSANDBOX_IMAGE)?.trim() || undefined;
    this.cpu = sandboxEnv.OPENSANDBOX_CPU;
    this.egressAllow = (sandboxEnv.OPENSANDBOX_EGRESS_ALLOW ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    this.memory = sandboxEnv.OPENSANDBOX_MEMORY;
    this.readyTimeout = sandboxEnv.OPENSANDBOX_READY_TIMEOUT;
    this.sessionIdleTimeout =
      options?.sessionIdleTimeout ?? sandboxEnv.OPENSANDBOX_SESSION_IDLE_TIMEOUT;
    this.sessionMaxLifetime =
      options?.sessionMaxLifetime ?? sandboxEnv.OPENSANDBOX_SESSION_MAX_LIFETIME;
    this.maxFileBytes = sandboxEnv.SANDBOX_MAX_FILE_BYTES;
    this.maxFileCount = sandboxEnv.SANDBOX_MAX_FILE_COUNT;
    this.maxOutputChars = sandboxEnv.SANDBOX_MAX_OUTPUT_CHARS;
  }

  isConfigured() {
    return !!this.baseUrl && !!this.image;
  }

  get keepsSessions() {
    return this.sessionIdleTimeout > 0;
  }

  /**
   * Runs `task` against one sandbox. With a `sessionKey` and a non-zero idle
   * timeout, calls in one conversation share a sandbox: files, installs, and
   * background processes carry over, and the sandbox is removed only after
   * the idle timeout without a call. Without either, the sandbox lives for
   * this call only. An optional max lifetime replaces a sandbox once it
   * reaches that age.
   */
  async withWorkspace<T>(
    options: SandboxSessionOptions,
    task: (workspace: SandboxWorkspace) => Promise<T>,
  ): Promise<T> {
    const sessionKey = this.keepsSessions ? options.sessionKey : undefined;
    if (!sessionKey) return this.runInSandbox(options, task);
    return withSessionLock(sessionKey, () => this.runInSandbox(options, task, sessionKey));
  }

  private async runInSandbox<T>(
    options: SandboxSessionOptions,
    task: (workspace: SandboxWorkspace) => Promise<T>,
    sessionKey?: string,
  ): Promise<T> {
    const startedAt = Date.now();
    const budgetMs = options.budgetMs;
    const baseFields = {
      operation: options.apiName,
      operationHash: options.operationHash,
      provider: this.id,
      sessionScoped: !!sessionKey,
      timeoutMs: budgetMs,
    };
    const settle = (fields: Record<string, unknown>) =>
      logGenerationDebugSafe('sandbox_run_settled', {
        ...baseFields,
        durationMs: Date.now() - startedAt,
        fileInCount: 0,
        fileOutCount: 0,
        stdoutChars: 0,
        ...fields,
      });

    logGenerationDebugSafe('sandbox_run_started', baseFields);

    if (!this.baseUrl || !this.image) {
      settle({ outcome: 'not_configured' });
      throw new SandboxError(
        'NotConfigured',
        'Sandbox is not configured: set OPENSANDBOX_SERVER_URL and OPENSANDBOX_IMAGE. The DifySandbox backend was removed.',
      );
    }

    const client = new OpenSandboxClient({ apiKey: this.apiKey, baseUrl: this.baseUrl });
    // Room a session sandbox needs before its retire time to host one call.
    const runBudgetMs = budgetMs + TTL_MARGIN_SECONDS * 1000;
    let phase: WorkspacePhase = 'ready';
    let workspace: OpenSandboxWorkspace | undefined;
    let sandboxId: string | undefined;
    let retireAt = 0;
    let keepSandbox = false;
    let reused = false;
    let retired = false;
    let lookupFailed = false;

    try {
      const readySignal = combineSignals(AbortSignal.timeout(this.readyTimeout), options.signal);
      const fingerprints = {
        network: networkPolicyFingerprint(
          buildNetworkPolicy(options.enableNetwork, this.egressAllow),
        ),
        runtime: runtimeFingerprint(this.image),
      };
      const lookup = sessionKey
        ? await this.reuseSandbox(client, sessionKey, runBudgetMs, fingerprints, readySignal)
        : undefined;
      retired = !!lookup?.retired;
      lookupFailed = !!lookup?.lookupFailed;
      let execd: ExecdEndpoint;
      let createdAt: number | undefined;
      if (lookup?.sandbox) {
        ({ createdAt, execd, id: sandboxId } = lookup.sandbox);
        reused = true;
      } else {
        if (options.createIfMissing === false) {
          throw new SandboxError(
            'NotFound',
            'This conversation has no running sandbox. It was removed after being idle or replaced, so its files and processes are gone.',
          );
        }
        ({ createdAt, execd, id: sandboxId } = await this.createSandbox(
          client,
          options,
          budgetMs,
          sessionKey,
          readySignal,
        ));
      }
      retireAt = this.retireAt(createdAt);

      workspace = new OpenSandboxWorkspace(
        client,
        execd,
        !reused,
        {
          maxFileBytes: this.maxFileBytes,
          maxFileCount: this.maxFileCount,
          maxOutputChars: this.maxOutputChars,
        },
        options.signal,
      );
      const result = await task(workspace);

      // A failing command is still a healthy sandbox worth keeping.
      keepSandbox = !!sessionKey;
      const { exitCode, fileInCount, fileOutCount, stdoutChars, timedOut } = workspace.stats;
      settle({
        exitCode,
        fileInCount,
        fileOutCount,
        outcome: timedOut ? 'timeout' : exitCode === undefined || exitCode === 0 ? 'ok' : 'error',
        sandboxLookupFailed: lookupFailed,
        sandboxRetired: retired,
        sandboxReused: reused,
        stdoutChars,
      });
      return result;
    } catch (error) {
      if (workspace) phase = workspace.phase;
      const classified = this.classifyError(error, phase, budgetMs, options.signal);
      // execd killed a process at its time limit, the caller stopped, or the
      // request itself was wrong: the sandbox is fine. Any other failure may
      // mean a broken sandbox, so the next call starts fresh.
      keepSandbox = !!sessionKey && keepsSandbox(classified);
      settle({
        errorKind: classified.code,
        failurePhase: phase,
        fileInCount: workspace?.stats.fileInCount ?? 0,
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
    options: SandboxSessionOptions,
    budgetMs: number,
    sessionKey: string | undefined,
    signal: AbortSignal,
  ) {
    const requestedAt = Date.now();
    const networkPolicy = buildNetworkPolicy(options.enableNetwork, this.egressAllow);
    const created = await client.createSandbox(
      {
        entrypoint: SANDBOX_ENTRYPOINT,
        image: { uri: this.image! },
        metadata: {
          [NETWORK_METADATA_KEY]: networkPolicyFingerprint(networkPolicy),
          [RUNTIME_METADATA_KEY]: runtimeFingerprint(this.image!),
          ...(sessionKey ? { [SESSION_METADATA_KEY]: sessionKey } : {}),
          name: SANDBOX_METADATA_NAME,
        },
        networkPolicy,
        resourceLimits: { cpu: this.cpu, memory: this.memory },
        // Covers this call only. A session sandbox is extended by the idle
        // timeout after each call, so a crash mid-call still frees it soon.
        timeout: Math.max(
          MIN_TTL_SECONDS,
          Math.ceil((this.readyTimeout + budgetMs) / 1000) + TTL_MARGIN_SECONDS,
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
   * coming call. One that does not respond, is too close to its optional max
   * lifetime to finish the call, or was created with a different network
   * policy, image, or layout, is deleted, and the caller creates a fresh one.
   * So does a failed lookup: reuse must never be why a call fails.
   */
  private async reuseSandbox(
    client: OpenSandboxClient,
    sessionKey: string,
    runBudgetMs: number,
    fingerprints: { network: string; runtime: string },
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
    for (const { createdAt, id, metadata } of found) {
      if (
        this.retireAt(createdAt) - Date.now() < runBudgetMs ||
        !networkCompatible(metadata?.[NETWORK_METADATA_KEY], fingerprints.network) ||
        metadata?.[RUNTIME_METADATA_KEY] !== fingerprints.runtime
      ) {
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

  /**
   * Keeps a session sandbox for the idle timeout, and with an age cap never
   * past its retire time; one too close to that to host another call is
   * deleted now. Best effort: if the renew fails, the sandbox still expires
   * at its earlier deadline.
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

  private classifyError(
    error: unknown,
    phase: WorkspacePhase,
    budgetMs: number,
    callerSignal?: AbortSignal,
  ): SandboxError {
    if (error instanceof SandboxError) return error;

    if (callerSignal?.aborted && isAbortError(error)) {
      return new SandboxError('Cancelled', 'The sandbox call was cancelled.');
    }

    if (error instanceof OpenSandboxHttpError) {
      const httpStatus = error.status;
      if (httpStatus === 401 || httpStatus === 403) {
        return new SandboxError('Unauthorized', 'OpenSandbox server rejected the API key.', {
          httpStatus,
        });
      }
      // execd answered (it reports a bad path or cwd as 400 or 500), so the
      // request failed, not the sandbox. 502-504 come from the server proxy
      // when execd is gone.
      const execdAnswered =
        phase !== 'ready' &&
        ((httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429) || httpStatus === 500);
      if (execdAnswered) return new SandboxRequestError(error.message, { httpStatus });
      if (httpStatus === 429 || httpStatus >= 500) {
        return new SandboxError('Unavailable', error.message, { httpStatus });
      }
      return new SandboxError('ExecutionFailed', error.message, { httpStatus });
    }

    if (isAbortError(error)) {
      if (phase === 'run') {
        return new SandboxError('Timeout', `Sandbox timed out after ${budgetMs}ms.`);
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
