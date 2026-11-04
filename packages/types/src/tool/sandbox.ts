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
  /** Background job: ISO time it is stopped if still running. */
  deadlineAt?: string;
  durationMs?: number;
  endLine?: number;
  entries?: SandboxFileEntry[];
  error?: string;
  exitCode?: number;
  /** Background job: ISO time it ended. */
  finishedAt?: string;
  /** Guidance for the model about what to do next. */
  hint?: string;
  /** Background job id (`startJob`). */
  jobId?: string;
  jobStatus?: SandboxJobStatus;
  /** `listJobs`: this conversation's jobs, newest first. */
  jobs?: SandboxJobItem[];
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
  /** Background job: ISO time it started. */
  startedAt?: string;
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
  { mode: 'allowlist'; targets: string[] } | { mode: 'none' } | { mode: 'open' };

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
  'cancelled' | 'failed' | 'lost' | 'running' | 'succeeded' | 'timed_out';

/** A file a finished job left in its output folder, copied to chat storage. */
export interface SandboxJobFile {
  fileId?: string;
  filename: string;
  /** Stable open URL, as `exportFile` returns it. */
  url?: string;
}

/** Hub background jobs: every running job, plus one page of finished jobs. */
export interface SandboxHubJobList {
  finished: {
    items: SandboxJobItem[];
    page: number;
    pageSize: number;
    total: number;
  };
  running: SandboxJobItem[];
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

/** Whether a profile's image was pulled on its server ahead of users ("Prepare image"). */
export type SandboxImageStatus = 'failed' | 'preparing' | 'ready' | 'unknown';

/** A profile's network as stored: the profiles-file value, or null to inherit OPENSANDBOX_EGRESS_ALLOW. */
export type SandboxProfileEgressSetting = 'none' | 'open' | string[];

/** A Sandbox Hub profile's settings as an admin edits them; an empty setting inherits OPENSANDBOX_*. */
export interface SandboxHubProfileSettingsInput {
  avatar?: string | null;
  cpu?: string | null;
  defaultEnabled: boolean;
  description: string;
  egress?: SandboxProfileEgressSetting | null;
  image?: string | null;
  instructionBase: 'general' | 'none';
  instructionText?: string | null;
  jobMaxRuntimeMs?: number | null;
  memory?: string | null;
  name: string;
  readyTimeoutMs?: number | null;
  serverId: string;
  sessionIdleTimeoutMs?: number | null;
  sessionMaxLifetimeMs?: number | null;
}

/** A profile in the Hub admin editor. */
export interface SandboxHubProfileSettingsItem extends SandboxHubProfileSettingsInput {
  /** False for `general` (agents use lobe-sandbox) and for the last profile. */
  deletable: boolean;
  id: string;
  imageStatus: SandboxImageStatus;
  imageStatusMessage?: string;
  /** ISO time of the image status. */
  imageStatusUpdatedAt?: string;
  /** Why users are not offered this profile (no image known, unknown server). */
  issue?: string;
  /** ISO time of the last settings change. */
  updatedAt: string;
}

/** A sandbox server from the profiles file, as the Hub server dropdown lists it. */
export interface SandboxHubServerItem {
  id: string;
  name: string;
  status: 'misconfigured' | 'ok';
}

/** Everything the Hub admin editor shows. */
export interface SandboxHubSettings {
  /** The OPENSANDBOX_* values an empty setting inherits. */
  defaults: {
    cpu: string;
    egress: SandboxProfileEgress;
    image?: string;
    jobMaxRuntimeMs: number;
    memory: string;
    readyTimeoutMs: number;
    sessionIdleTimeoutMs: number;
    sessionMaxLifetimeMs: number;
  };
  maxProfiles: number;
  profiles: SandboxHubProfileSettingsItem[];
  servers: SandboxHubServerItem[];
}

/**
 * A saved sandbox environment variable as the Hub shows it. A sensitive value
 * never leaves the server. A value that is not sensitive is returned so it can
 * be edited.
 */
export interface SandboxEnvItem {
  /** `••••` and the last 4 characters of a long sensitive value. */
  hint?: string;
  name: string;
  /** ISO time of the last change. */
  updatedAt: string;
  /** Present only when the variable is not marked sensitive. */
  value?: string;
}

/** Sandbox environment variables the signed-in user can see, per profile. */
export interface SandboxEnvList {
  /** False when the server has no KEY_VAULTS_SECRET to encrypt values with. */
  available: boolean;
  profiles: Record<string, { mine: SandboxEnvItem[]; shared: SandboxEnvItem[] }>;
}
