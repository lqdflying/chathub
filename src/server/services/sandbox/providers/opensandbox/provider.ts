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
  type CreateSandboxRequest,
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
// Container label naming the Sandbox Hub profile that created the sandbox.
// Informational (operator cleanup, debugging): reuse never requires it, so
// sandboxes created before profiles existed are still reused.
export const PROFILE_METADATA_KEY = 'chathub-profile';
// Container label with an HMAC of the Sandbox Hub environment variables the
// sandbox was created with (absent: none). A tool call whose variables differ
// replaces the sandbox; calls that pass no variables (job checks) skip it.
export const ENV_METADATA_KEY = 'chathub-env';
const NO_ENV_FINGERPRINT = 'none';
// Container label with an HMAC of the Sandbox Hub files written into the
// sandbox after it was created (absent: none). Compared like `chathub-env`.
export const FILES_METADATA_KEY = 'chathub-files';
const NO_FILES_FINGERPRINT = 'none';
// Container label with an unkeyed SHA-256 of the persistent folder's claim
// name and mount path (absent: none). Compared like `chathub-env`.
export const VOLUME_METADATA_KEY = 'chathub-volume';
const NO_VOLUME_FINGERPRINT = 'none';
/** The persistent folder's name in the create request's `volumes` list. */
export const PERSISTENT_VOLUME_NAME = 'chathub-persist';
// Name label of the throwaway sandbox that empties a persistent folder; never reused.
export const SANDBOX_MAINTENANCE_METADATA_NAME = 'chathub-sandbox-maintenance';
export const SANDBOX_METADATA_NAME = 'chathub-sandbox';
// Name label of the throwaway sandbox "Prepare image" creates; never reused.
export const SANDBOX_PREPARE_METADATA_NAME = 'chathub-sandbox-prepare';
// The prepare sandbox's create TTL: a long pull plus margin. Deleted right after.
const PREPARE_TTL_SECONDS = 20 * 60;
// The throwaway sandbox that empties a persistent folder: create TTL and command limit.
const MAINTENANCE_TTL_SECONDS = 10 * 60;
const EMPTY_FOLDER_TIMEOUT_MS = 120_000;
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

/** Files written into a new sandbox before its first command, and their label value. */
export interface SandboxFilesSpec {
  /** Undefined when there are no files. */
  fingerprint?: string;
  items: Array<{ content: Uint8Array; mode: number; path: string }>;
}

/**
 * The persistent folder a new sandbox mounts, and its label value. Given
 * without `mount` when the profile has none, so a reused sandbox that has
 * one is replaced.
 */
export interface SandboxVolumeSpec {
  /** Undefined without a mount. */
  fingerprint?: string;
  mount?: { claimName: string; mountPath: string };
}

/** The create request's entry for a persistent folder volume. */
export const persistentVolume = (
  mount: { claimName: string; mountPath: string },
  createIfNotExists: boolean,
) => ({
  mountPath: mount.mountPath,
  name: PERSISTENT_VOLUME_NAME,
  pvc: { claimName: mount.claimName, createIfNotExists },
  readOnly: false,
});

/** Environment variables a sandbox is created with, and their label value. */
export interface SandboxEnvSpec {
  /** Undefined when there are no variables. */
  fingerprint?: string;
  values: Record<string, string>;
}

export class OpenSandboxProvider implements SandboxProvider {
  readonly id = 'opensandbox';
  private apiKey?: string;
  private baseUrl?: string;
  private cpu: string;
  private egressAllow: string[];
  private env?: SandboxEnvSpec;
  private files?: SandboxFilesSpec;
  private volume?: SandboxVolumeSpec;
  private image?: string;
  private imageAuth?: { password: string; username: string };
  private maxFileBytes: number;
  private maxFileCount: number;
  private maxOutputChars: number;
  private memory: string;
  private networkDisabled: boolean;
  private profileId?: string;
  private readyTimeout: number;
  private rebaseExecdEndpoint: boolean;
  private sessionIdleTimeout: number;
  private sessionMaxLifetime: number;

  /**
   * Every option falls back to OPENSANDBOX_*, so `new OpenSandboxProvider()`
   * is still today's single sandbox. Sandbox Hub profiles pass their own.
   */
  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    cpu?: string;
    /** Allowed egress targets; empty = no policy unless `networkDisabled`. */
    egressAllow?: string[];
    /**
     * Sandbox Hub variables for a new sandbox. Given (even empty), a reused
     * sandbox created with other values is replaced; omitted, that is not checked.
     */
    env?: SandboxEnvSpec;
    /**
     * Sandbox Hub files for a new sandbox, written right after it starts.
     * Given (even empty), a reused sandbox created with other files is
     * replaced; omitted, that is not checked.
     */
    files?: SandboxFilesSpec;
    image?: string;
    /** Registry login for the image, from the server's `registries`. */
    imageAuth?: { password: string; username: string };
    memory?: string;
    /** Profile `egress: none`: deny all egress unless a call opts in. */
    networkDisabled?: boolean;
    profileId?: string;
    readyTimeout?: number;
    /** Server `proxyEndpoint: baseUrl`: send execd calls to `baseUrl`, not the host the server returns. */
    rebaseExecdEndpoint?: boolean;
    sessionIdleTimeout?: number;
    sessionMaxLifetime?: number;
    /**
     * The persistent folder a new sandbox mounts. Given (even without a
     * mount), a reused sandbox created with another one is replaced;
     * omitted, that is not checked.
     */
    volume?: SandboxVolumeSpec;
  }) {
    this.baseUrl = (options?.baseUrl ?? sandboxEnv.OPENSANDBOX_SERVER_URL)?.replace(/\/+$/, '');
    // A profile server passes `apiKey` even when that server has none.
    // Only a constructor call that omits the field inherits OPENSANDBOX_API_KEY.
    this.apiKey =
      options && 'apiKey' in options ? options.apiKey : sandboxEnv.OPENSANDBOX_API_KEY;
    this.image = (options?.image ?? sandboxEnv.OPENSANDBOX_IMAGE)?.trim() || undefined;
    this.imageAuth = options?.imageAuth;
    this.cpu = options?.cpu ?? sandboxEnv.OPENSANDBOX_CPU;
    this.egressAllow =
      options?.egressAllow ??
      (sandboxEnv.OPENSANDBOX_EGRESS_ALLOW ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    this.env = options?.env;
    this.files = options?.files;
    this.volume = options?.volume;
    this.memory = options?.memory ?? sandboxEnv.OPENSANDBOX_MEMORY;
    this.networkDisabled = options?.networkDisabled ?? false;
    this.profileId = options?.profileId;
    this.readyTimeout = options?.readyTimeout ?? sandboxEnv.OPENSANDBOX_READY_TIMEOUT;
    this.rebaseExecdEndpoint = options?.rebaseExecdEndpoint ?? false;
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

  /** The create request's image, with the registry login when the server has one. */
  private imageSpec() {
    return { ...(this.imageAuth ? { auth: this.imageAuth } : {}), uri: this.image! };
  }

  /** A call's own `enableNetwork` wins; otherwise a profile with `egress: none` denies all. */
  private networkPolicy(options: SandboxSessionOptions) {
    const enableNetwork = options.enableNetwork ?? (this.networkDisabled ? false : undefined);
    return buildNetworkPolicy(enableNetwork, this.egressAllow);
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
        'Sandbox is not configured: set OPENSANDBOX_SERVER_URL and OPENSANDBOX_IMAGE, or a Sandbox Hub profile with a server and image.',
      );
    }

    const client = new OpenSandboxClient({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      rebaseExecdEndpoint: this.rebaseExecdEndpoint,
    });
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
        env: this.env ? (this.env.fingerprint ?? NO_ENV_FINGERPRINT) : undefined,
        files: this.files ? (this.files.fingerprint ?? NO_FILES_FINGERPRINT) : undefined,
        network: networkPolicyFingerprint(this.networkPolicy(options)),
        runtime: runtimeFingerprint(this.image),
        volume: this.volume ? (this.volume.fingerprint ?? NO_VOLUME_FINGERPRINT) : undefined,
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
          // A failed list is not proof the sandbox is gone. NotFound would
          // end a background job on the first blip instead of the 10-minute grace.
          if (lookupFailed) {
            throw new SandboxError(
              'Unavailable',
              'The sandbox server could not list sandboxes for this conversation.',
            );
          }
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

  /**
   * Makes the server pull this profile's image ahead of users. OpenSandbox
   * pulls a missing image while it creates a sandbox and has no pull
   * endpoint, so this creates a throwaway sandbox with the image, waits until
   * it runs (`signal` bounds the wait, which may be long for a large image),
   * and deletes it. An image already on the host is not pulled again.
   */
  async prepareImage(signal: AbortSignal): Promise<{ durationMs: number }> {
    if (!this.baseUrl || !this.image) {
      throw new SandboxError('NotConfigured', 'This sandbox has no server or image to prepare.');
    }
    const client = new OpenSandboxClient({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      rebaseExecdEndpoint: this.rebaseExecdEndpoint,
    });
    const startedAt = Date.now();
    // The profile's own policy: what its sandboxes get, so a server that
    // cannot enforce egress rules fails here exactly as it would for users.
    const networkPolicy = buildNetworkPolicy(
      this.networkDisabled ? false : undefined,
      this.egressAllow,
    );
    const created = await client.createSandbox(
      {
        entrypoint: SANDBOX_ENTRYPOINT,
        image: this.imageSpec(),
        metadata: {
          ...(this.profileId ? { [PROFILE_METADATA_KEY]: this.profileId } : {}),
          name: SANDBOX_PREPARE_METADATA_NAME,
        },
        ...(networkPolicy ? { networkPolicy } : {}),
        resourceLimits: { cpu: this.cpu, memory: this.memory },
        timeout: PREPARE_TTL_SECONDS,
      },
      signal,
    );
    try {
      await this.waitUntilRunning(client, created.id, created.state, signal);
    } finally {
      await this.deleteQuietly(client, created.id);
    }
    return { durationMs: Date.now() - startedAt };
  }

  /**
   * Deletes everything in one user's persistent folder volume: a throwaway
   * sandbox (no session, never reused) mounts the volume, removes its
   * contents, and is always deleted. The volume itself stays on the host:
   * OpenSandbox has no API to delete volumes. A volume that does not exist
   * yet is created empty.
   */
  async emptyPersistentFolder(
    mount: { claimName: string; mountPath: string },
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.baseUrl || !this.image) {
      throw new SandboxError('NotConfigured', 'This sandbox has no server or image.');
    }
    const client = new OpenSandboxClient({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      rebaseExecdEndpoint: this.rebaseExecdEndpoint,
    });
    // The profile's own policy, as its sandboxes get; the command needs no network.
    const networkPolicy = buildNetworkPolicy(
      this.networkDisabled ? false : undefined,
      this.egressAllow,
    );
    const created = await this.createWithVolumeHint(mount.mountPath, () =>
      client.createSandbox(
        {
          entrypoint: SANDBOX_ENTRYPOINT,
          image: this.imageSpec(),
          metadata: {
            ...(this.profileId ? { [PROFILE_METADATA_KEY]: this.profileId } : {}),
            name: SANDBOX_MAINTENANCE_METADATA_NAME,
          },
          ...(networkPolicy ? { networkPolicy } : {}),
          resourceLimits: { cpu: this.cpu, memory: this.memory },
          timeout: MAINTENANCE_TTL_SECONDS,
          volumes: [persistentVolume(mount, true)],
        },
        signal,
      ),
    );
    try {
      await this.waitUntilRunning(client, created.id, created.state, signal);
      const execd = await client.getExecdEndpoint(created.id, signal);
      await this.waitForExecd(client, execd, signal);
      const workspace = new OpenSandboxWorkspace(
        client,
        execd,
        true,
        {
          maxFileBytes: this.maxFileBytes,
          maxFileCount: this.maxFileCount,
          maxOutputChars: this.maxOutputChars,
        },
        signal,
      );
      const result = await workspace.exec({
        command: `find '${mount.mountPath.replaceAll("'", `'\\''`)}' -mindepth 1 -delete`,
        cwd: '/',
        timeoutMs: EMPTY_FOLDER_TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        throw new SandboxError(
          'ExecutionFailed',
          `Could not empty ${mount.mountPath}: ${(result.stderr || result.stdout).trim() || `exit code ${result.exitCode ?? 'unknown'}`}`,
        );
      }
    } finally {
      await this.deleteQuietly(client, created.id);
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
    const networkPolicy = this.networkPolicy(options);
    const mount = this.volume?.mount;
    const body: CreateSandboxRequest = {
      entrypoint: SANDBOX_ENTRYPOINT,
      ...(this.env && Object.keys(this.env.values).length > 0 ? { env: this.env.values } : {}),
      image: this.imageSpec(),
      metadata: {
        ...(this.env?.fingerprint ? { [ENV_METADATA_KEY]: this.env.fingerprint } : {}),
        ...(this.files?.fingerprint ? { [FILES_METADATA_KEY]: this.files.fingerprint } : {}),
        ...(this.volume?.fingerprint ? { [VOLUME_METADATA_KEY]: this.volume.fingerprint } : {}),
        [NETWORK_METADATA_KEY]: networkPolicyFingerprint(networkPolicy),
        [RUNTIME_METADATA_KEY]: runtimeFingerprint(this.image!),
        ...(this.profileId ? { [PROFILE_METADATA_KEY]: this.profileId } : {}),
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
      // The user's own volume; OpenSandbox creates it on first use and keeps it.
      ...(mount ? { volumes: [persistentVolume(mount, true)] } : {}),
    };
    const created = await this.createWithVolumeHint(mount?.mountPath, () =>
      client.createSandbox(body, signal),
    );
    try {
      await this.waitUntilRunning(client, created.id, created.state, signal);
      const execd = await client.getExecdEndpoint(created.id, signal);
      await this.waitForExecd(client, execd, signal);
      await this.writeHubFiles(client, execd, signal);
      return { createdAt: created.createdAt ?? requestedAt, execd, id: created.id };
    } catch (error) {
      // The caller never learns the id, so the sandbox is removed here. A
      // sandbox whose Sandbox Hub files could not be written is removed too.
      await this.deleteQuietly(client, created.id);
      throw error;
    }
  }

  /**
   * Runs a create request. When it mounts a persistent folder and the server
   * refuses a volume (a runtime without volumes, such as fast sandboxes, or a
   * server too old for Docker named volumes), the error says so.
   */
  private async createWithVolumeHint<T>(
    mountPath: string | undefined,
    create: () => Promise<T>,
  ): Promise<T> {
    try {
      return await create();
    } catch (error) {
      if (!mountPath || !(error instanceof OpenSandboxHttpError)) throw error;
      if (!/volume|pvc|mount/i.test(error.message)) throw error;
      throw new SandboxError(
        'Unavailable',
        `${error.message} (this sandbox mounts a persistent folder at ${mountPath}; the OpenSandbox server must support Docker named volumes)`,
      );
    }
  }

  /**
   * Writes the Sandbox Hub files into a sandbox that was just created, one
   * request per file so a failure names its path. execd creates missing
   * parent folders and applies each file's mode.
   */
  private async writeHubFiles(
    client: OpenSandboxClient,
    execd: ExecdEndpoint,
    signal: AbortSignal,
  ) {
    for (const file of this.files?.items ?? []) {
      try {
        await client.uploadFiles(execd, [file], signal);
      } catch (error) {
        if (signal.aborted) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        throw new SandboxError(
          'ExecutionFailed',
          `Could not write the Sandbox Hub file ${file.path} into the new sandbox: ${reason}`,
        );
      }
    }
  }

  /**
   * Finds this conversation's running sandbox and pushes its expiry past the
   * coming call. One that does not respond, is too close to its optional max
   * lifetime to finish the call, or was created with a different network
   * policy, image, layout, or (when given) environment variables, is
   * deleted, and the caller creates a fresh one.
   * Other Running sandboxes with the same session key are deleted after one
   * is chosen. A failed lookup does not delete anything: reuse must never be
   * why a call fails.
   */
  private async reuseSandbox(
    client: OpenSandboxClient,
    sessionKey: string,
    runBudgetMs: number,
    fingerprints: {
      env?: string;
      files?: string;
      network: string;
      runtime: string;
      volume?: string;
    },
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
    let chosen: { createdAt?: number; execd: ExecdEndpoint; id: string } | undefined;
    const extras: string[] = [];
    for (const { createdAt, id, metadata } of found) {
      if (chosen) {
        extras.push(id);
        continue;
      }
      if (
        this.retireAt(createdAt) - Date.now() < runBudgetMs ||
        !networkCompatible(metadata?.[NETWORK_METADATA_KEY], fingerprints.network) ||
        metadata?.[RUNTIME_METADATA_KEY] !== fingerprints.runtime ||
        (fingerprints.env !== undefined &&
          (metadata?.[ENV_METADATA_KEY] ?? NO_ENV_FINGERPRINT) !== fingerprints.env) ||
        (fingerprints.files !== undefined &&
          (metadata?.[FILES_METADATA_KEY] ?? NO_FILES_FINGERPRINT) !== fingerprints.files) ||
        (fingerprints.volume !== undefined &&
          (metadata?.[VOLUME_METADATA_KEY] ?? NO_VOLUME_FINGERPRINT) !== fingerprints.volume)
      ) {
        retired = true;
        await this.deleteQuietly(client, id);
        continue;
      }
      try {
        await client.renewExpiration(id, new Date(Date.now() + runBudgetMs), signal);
        const execd = await client.getExecdEndpoint(id, signal);
        if (await client.pingExecd(execd, AbortSignal.timeout(REUSE_PING_TIMEOUT_MS))) {
          chosen = { createdAt, execd, id };
          continue;
        }
      } catch (error) {
        if (signal.aborted) throw error;
      }
      await this.deleteQuietly(client, id);
    }
    for (const id of extras) await this.deleteQuietly(client, id);
    return chosen ? { retired, sandbox: chosen } : { retired };
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
