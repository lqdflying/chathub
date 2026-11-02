import type { CodeInterpreterResponse } from './interpreter';

export interface SandboxFileEntry {
  path: string;
  /** Bytes; files only. */
  size?: number;
  type: 'directory' | 'file' | 'other' | 'symlink';
}

/**
 * Result of any Sandbox tool API, serialized as the tool message content.
 * `runPython` keeps the Code Interpreter shape (`output`, `files`); the other
 * APIs fill the fields that apply to them.
 */
export interface SandboxToolResult extends CodeInterpreterResponse {
  /** `runCommand` started the command in the background. */
  background?: boolean;
  /** `readFile`: the file is not text. */
  binary?: boolean;
  /** `writeFile`: bytes written. */
  bytes?: number;
  commandId?: string;
  /** `readFile`: numbered lines. */
  content?: string;
  durationMs?: number;
  endLine?: number;
  entries?: SandboxFileEntry[];
  error?: string;
  exitCode?: number;
  /** Guidance for the model about what to do next. */
  hint?: string;
  /** `getCommandOutput`: combined stdout and stderr since the cursor. */
  log?: string;
  nextCursor?: number;
  path?: string;
  replacements?: number;
  running?: boolean;
  size?: number;
  /** `exportFile`: paths that could not be exported, with the reason. */
  skipped?: string[];
  startLine?: number;
  stderr?: string;
  stdout?: string;
  timedOut?: boolean;
  totalLines?: number;
  truncated?: boolean;
}

export interface SandboxToolState {
  error?: any;
}

export type SandboxProfileEgress =
  | { mode: 'allowlist'; targets: string[] }
  | { mode: 'none' }
  | { mode: 'open' };

/**
 * One operator-defined Sandbox Hub profile as a user sees it. Server URLs,
 * API keys and images never reach the browser.
 */
export interface SandboxProfileItem {
  /** The profile's server has the credentials it declares. */
  available: boolean;
  avatar?: string;
  cpu: string;
  defaultEnabled: boolean;
  description: string;
  egress: SandboxProfileEgress;
  /** The user's Hub choice, or `defaultEnabled` without one. */
  enabled: boolean;
  id: string;
  /** Tool identifier: `lobe-sandbox` for `general`, else `lobe-sandbox--<id>`. */
  identifier: string;
  /** Instruction injected while the tool is enabled: an admin edit, else the starting text. */
  instruction: string;
  /** An admin edited the instruction; reset restores the starting text. */
  instructionCustomized: boolean;
  /** ISO time of the last admin edit. */
  instructionUpdatedAt?: string;
  memory: string;
  name: string;
  serverId: string;
  serverName: string;
  sessionIdleTimeoutMs: number;
  sessionMaxLifetimeMs: number;
}

export type SandboxServerHealth = 'misconfigured' | 'ok' | 'unauthorized' | 'unreachable';

/** What the signed-in user may change in Sandbox Hub beyond their own on/off choices. */
export interface SandboxHubAccess {
  /** `SANDBOX_HUB_ADMINS` lists at least one admin. */
  adminsConfigured: boolean;
  canEditInstructions: boolean;
}

/** Lifecycle of a Sandbox background job (`startJob`). Only `running` changes later. */
export type SandboxJobStatus =
  | 'cancelled'
  | 'failed'
  | 'lost'
  | 'running'
  | 'succeeded'
  | 'timed_out';

/** A file a finished job left in its output folder, copied to chat storage. */
export interface SandboxJobFile {
  fileId?: string;
  filename: string;
  /** Stable open URL, as `exportFile` returns it. */
  url?: string;
}

/** A background job as the Sandbox Hub lists it. */
export interface SandboxJobItem {
  /** First line of the command, shortened. */
  command: string;
  exitCode?: number;
  /** ISO time the job ended. */
  finishedAt?: string;
  id: string;
  profileId: string;
  /** ISO time the job started. */
  startedAt: string;
  status: SandboxJobStatus;
}
