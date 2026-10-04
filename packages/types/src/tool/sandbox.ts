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
