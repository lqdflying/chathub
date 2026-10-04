export type SandboxOutcome = 'ok' | 'error' | 'timeout' | 'unavailable' | 'not_configured';

export type SandboxErrorCode =
  | 'Cancelled'
  | 'NotConfigured'
  | 'NotFound'
  | 'Timeout'
  | 'Unavailable'
  | 'ExecutionFailed'
  | 'Unauthorized';

export interface SandboxFile {
  content: Uint8Array;
  filename: string;
}

/**
 * A conversation file the sandbox may need. Bytes load only when the
 * sandbox does not have this file yet.
 */
export interface SandboxInputRef {
  filename: string;
  id: string;
  load: () => Promise<Uint8Array | undefined>;
}

export interface SandboxCommandResult {
  durationMs: number;
  exitCode?: number;
  /** Killed before the time limit, e.g. out of memory. */
  killed: boolean;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

export interface SandboxPythonResult {
  exitCode?: number;
  files: SandboxFile[];
  stderr: string;
  stdout: string;
  success: boolean;
}

export type SandboxEntryType = 'directory' | 'file' | 'other' | 'symlink';

export interface SandboxEntry {
  /** Octal permission bits as execd reports them, e.g. 644. */
  mode?: number;
  modifiedAt?: string;
  path: string;
  size: number;
  type: SandboxEntryType;
}

export interface SandboxCommandStatus {
  error?: string;
  exitCode?: number;
  running: boolean;
}

export interface SandboxCommandLogs {
  /** Byte offset to pass back for the next read. */
  cursor?: number;
  output: string;
}

/** One sandbox, held for the duration of a `withWorkspace` task. */
export interface SandboxWorkspace {
  commandLogs(id: string, cursor?: number): Promise<SandboxCommandLogs>;
  commandStatus(id: string): Promise<SandboxCommandStatus>;
  exec(input: { command: string; cwd?: string; timeoutMs: number }): Promise<SandboxCommandResult>;
  fileInfo(path: string): Promise<SandboxEntry | undefined>;
  /** True when this call created the sandbox. */
  readonly fresh: boolean;
  interrupt(id: string): Promise<void>;
  listDirectory(path: string, depth: number): Promise<SandboxEntry[]>;
  /** Records persisted output files so a later sync does not upload them again. */
  markSynced(ids: string[]): Promise<void>;
  readFile(path: string, maxBytes: number): Promise<Uint8Array>;
  runPython(input: {
    code: string;
    inputs: SandboxInputRef[];
    timeoutMs: number;
  }): Promise<SandboxPythonResult>;
  startBackground(input: { command: string; cwd?: string }): Promise<string>;
  /** Uploads conversation files the sandbox has not received yet. */
  syncInputs(inputs: SandboxInputRef[]): Promise<void>;
  readonly workdir: string;
  writeFile(path: string, content: Uint8Array, mode?: number): Promise<void>;
}

export interface SandboxSessionOptions {
  /** Tool API being served; logged only. */
  apiName?: string;
  /** Longest step the task will run, in milliseconds. Sizes the sandbox TTL. */
  budgetMs: number;
  /**
   * False: only reuse this conversation's running sandbox. Without one, the
   * call fails with `NotFound` instead of creating an empty sandbox.
   */
  createIfMissing?: boolean;
  enableNetwork?: boolean;
  operationHash?: string;
  /**
   * Opaque, hashed conversation scope (user, agent or group, topic, thread).
   * Calls with the same key share one sandbox while it stays alive.
   */
  sessionKey?: string;
  signal?: AbortSignal;
}

export const sandboxOutcomeFromErrorCode = (code: SandboxErrorCode): SandboxOutcome => {
  switch (code) {
    case 'NotConfigured': {
      return 'not_configured';
    }
    case 'Timeout': {
      return 'timeout';
    }
    case 'Unavailable': {
      return 'unavailable';
    }
    default: {
      return 'error';
    }
  }
};

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  readonly httpStatus?: number;
  readonly outcome: SandboxOutcome;

  constructor(
    code: SandboxErrorCode,
    message: string,
    options?: { httpStatus?: number; outcome?: SandboxOutcome },
  ) {
    super(message);
    this.name = 'SandboxError';
    this.code = code;
    this.httpStatus = options?.httpStatus;
    this.outcome = options?.outcome ?? sandboxOutcomeFromErrorCode(code);
  }
}

/**
 * The sandbox answered, but the request itself failed: a missing file, a
 * directory where a file was expected, an unknown command id. The sandbox
 * stays healthy and is kept.
 */
export class SandboxRequestError extends SandboxError {
  constructor(message: string, options?: { httpStatus?: number }) {
    super('ExecutionFailed', message, options);
    this.name = 'SandboxRequestError';
  }
}

export interface SandboxProvider {
  readonly id: string;
  isConfigured(): boolean;
  /** False when every call gets a fresh sandbox, so nothing carries over. */
  readonly keepsSessions: boolean;
  withWorkspace<T>(
    options: SandboxSessionOptions,
    task: (workspace: SandboxWorkspace) => Promise<T>,
  ): Promise<T>;
}
