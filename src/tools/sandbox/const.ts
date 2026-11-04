export const SandboxIdentifier = 'lobe-sandbox';

/**
 * The Sandbox tool was the Code Interpreter. Its identifier is still stored on
 * old tool messages and, until migrated, in agent plugin lists.
 */
export const LegacyCodeInterpreterIdentifier = 'lobe-code-interpreter';

export const SandboxApiName = {
  cancelJob: 'cancelJob',
  editFile: 'editFile',
  exportFile: 'exportFile',
  getCommandOutput: 'getCommandOutput',
  getJobResult: 'getJobResult',
  listFiles: 'listFiles',
  listJobs: 'listJobs',
  readFile: 'readFile',
  runCommand: 'runCommand',
  runPython: 'runPython',
  startJob: 'startJob',
  stopCommand: 'stopCommand',
  writeFile: 'writeFile',
} as const;

export type SandboxApiNameType = (typeof SandboxApiName)[keyof typeof SandboxApiName];

/** The Code Interpreter's only API; old messages still carry it. */
export const LegacyPythonApiName = 'python';

/** Working directory inside the sandbox. Under /tmp so it stays writable with execd's Landlock floor. */
export const SANDBOX_WORKDIR = '/tmp/workspace';

/** ChatHub's hidden files in the sandbox; never listed or returned as outputs. */
export const SANDBOX_CONTROL_DIR = `${SANDBOX_WORKDIR}/.chathub`;

/** Retired builtin tool identifiers and the tool that now serves them. */
export const LEGACY_BUILTIN_TOOL_ALIASES: Record<string, string> = {
  [LegacyCodeInterpreterIdentifier]: SandboxIdentifier,
};

/** Maps a retired builtin identifier to its current one; others pass through. */
export const resolveBuiltinToolAlias = (identifier: string) =>
  LEGACY_BUILTIN_TOOL_ALIASES[identifier] ?? identifier;

const normalizedLists = new WeakMap<readonly string[], string[]>();

/**
 * Plugin list with retired builtin identifiers replaced, without duplicates.
 * Returns the same array when nothing needs replacing, and the same result
 * for the same input, so store selectors stay referentially stable.
 */
export const normalizeBuiltinToolIds = (ids: readonly string[]): string[] => {
  if (!ids.some((id) => Object.hasOwn(LEGACY_BUILTIN_TOOL_ALIASES, id))) return ids as string[];
  let normalized = normalizedLists.get(ids);
  if (!normalized) {
    normalized = [...new Set(ids.map(resolveBuiltinToolAlias))];
    normalizedLists.set(ids, normalized);
  }
  return normalized;
};

/**
 * Sandbox profiles (Sandbox Hub). The `general` profile keeps the original
 * `lobe-sandbox` identifier so existing agents, tool messages and parked
 * sandboxes stay valid; every other profile is `lobe-sandbox--<profileId>`.
 */
export const DEFAULT_SANDBOX_PROFILE_ID = 'general';
/** Instruction-table key for the shared General instruction. Not a profile id. */
export const SANDBOX_SHARED_INSTRUCTION_ID = '_shared';

/**
 * Keeps `lobe-sandbox--<id>____<api>____builtin` under 64 characters, the
 * point where ToolNameResolver hashes names. The durable worker splits tool
 * names on `____` and cannot undo that hash.
 */
export const SANDBOX_PROFILE_ID_MAX_LENGTH = 16;

/** Largest profile instruction, from the profiles file or an admin edit (UTF-8 bytes). */
export const SANDBOX_INSTRUCTION_MAX_BYTES = 32 * 1024;

/** Sandbox Hub environment variable names: shell style, capitals. */
export const SANDBOX_ENV_NAME_PATTERN = /^[A-Z_][\dA-Z_]{0,63}$/;
/** Names the sandbox runtime or its services rely on. */
const SANDBOX_ENV_RESERVED_NAMES = new Set([
  'HOME',
  'HOSTNAME',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'PATH',
  'PWD',
  'SHELL',
  'USER',
]);
const SANDBOX_ENV_RESERVED_PREFIXES = ['CHATHUB_', 'EXECD_', 'OPENSANDBOX_'];
/** Largest variable value (UTF-8 bytes). */
export const SANDBOX_ENV_VALUE_MAX_BYTES = 8 * 1024;

export const isReservedSandboxEnvName = (name: string) =>
  SANDBOX_ENV_RESERVED_NAMES.has(name) ||
  SANDBOX_ENV_RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix));

/** Largest Sandbox Hub secret file (bytes). */
export const SANDBOX_FILE_MAX_BYTES = 64 * 1024;
export const SANDBOX_FILE_PATH_MAX_LENGTH = 255;
/** Permission bits as three octal digits, e.g. 600. */
export const SANDBOX_FILE_MODE_PATTERN = /^[0-7]{3}$/;
export const SANDBOX_FILE_DEFAULT_MODE = '600';
export const SANDBOX_FILE_MODE_PRESETS = ['600', '640', '644', '660', '400'] as const;
const SANDBOX_FILE_PATH_CHARS = /^\/[\w+./@-]+$/;
/** The workspace holds conversation files and ChatHub's control folder. */
const SANDBOX_FILE_BLOCKED_ROOTS = [SANDBOX_WORKDIR, '/proc', '/sys', '/dev'];

/**
 * Why a secret file's destination is refused: `format` (not an absolute,
 * normalized path of allowed characters) or `blocked` (inside the workspace
 * or a system folder). Undefined when allowed.
 */
export const sandboxFilePathProblem = (path: string): 'blocked' | 'format' | undefined => {
  if (path.length > SANDBOX_FILE_PATH_MAX_LENGTH || !SANDBOX_FILE_PATH_CHARS.test(path)) {
    return 'format';
  }
  const segments = path.split('/').slice(1);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return 'format';
  }
  if (SANDBOX_FILE_BLOCKED_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))) {
    return 'blocked';
  }
  return undefined;
};

/** Default mount path of a profile's persistent folder. */
export const SANDBOX_PERSISTENT_FOLDER_DEFAULT = '/persist';
/** Folders the image needs; a persistent folder may not be one of them or inside one. */
const SANDBOX_MOUNT_BLOCKED_TREES = [
  '/bin',
  '/boot',
  '/etc',
  '/lib',
  '/lib32',
  '/lib64',
  '/libx32',
  '/run',
  '/sbin',
  '/tmp',
  '/usr',
  '/var',
];
/** Folders a persistent folder may sit under but not replace. */
const SANDBOX_MOUNT_BLOCKED_EXACT = new Set(['/home', '/mnt', '/opt', '/root', '/srv']);

/**
 * Why a persistent folder's mount path is refused: `format` (not an
 * absolute, normalized path) or `blocked` (the workspace, a system folder,
 * or a folder the image needs). Undefined when allowed, e.g. /persist,
 * /root/persist, /data or /mnt/data.
 */
export const sandboxMountPathProblem = (path: string): 'blocked' | 'format' | undefined => {
  const fileProblem = sandboxFilePathProblem(path);
  if (fileProblem) return fileProblem;
  if (
    SANDBOX_MOUNT_BLOCKED_EXACT.has(path) ||
    SANDBOX_MOUNT_BLOCKED_TREES.some((root) => path === root || path.startsWith(`${root}/`))
  ) {
    return 'blocked';
  }
  return undefined;
};

/** True when `path` is the folder `root` or inside it. */
export const isPathInside = (path: string, root: string) =>
  path === root || path.startsWith(`${root}/`);

const SANDBOX_PROFILE_SEPARATOR = '--';
const SANDBOX_PROFILE_ID_PATTERN = /^[a-z][\da-z]*(?:-[\da-z]+)*$/;
const SANDBOX_PROFILE_PREFIX = `${SandboxIdentifier}${SANDBOX_PROFILE_SEPARATOR}`;

/** Lowercase letters, digits and single hyphens; no `_` so `____` can never appear. */
export const isValidSandboxProfileId = (id: string) =>
  id.length > 0 &&
  id.length <= SANDBOX_PROFILE_ID_MAX_LENGTH &&
  SANDBOX_PROFILE_ID_PATTERN.test(id);

export const sandboxToolIdentifier = (profileId: string) =>
  profileId === DEFAULT_SANDBOX_PROFILE_ID
    ? SandboxIdentifier
    : `${SANDBOX_PROFILE_PREFIX}${profileId}`;

/**
 * Syntactic parse only. Whether the profile is configured and enabled for the
 * user is decided server-side when the tool is invoked.
 */
export const parseSandboxToolIdentifier = (
  identifier?: string | null,
): { profileId: string } | undefined => {
  if (!identifier) return undefined;
  if (identifier === SandboxIdentifier || identifier === LegacyCodeInterpreterIdentifier) {
    return { profileId: DEFAULT_SANDBOX_PROFILE_ID };
  }
  if (!identifier.startsWith(SANDBOX_PROFILE_PREFIX)) return undefined;
  const profileId = identifier.slice(SANDBOX_PROFILE_PREFIX.length);
  if (profileId === DEFAULT_SANDBOX_PROFILE_ID || !isValidSandboxProfileId(profileId)) {
    return undefined;
  }
  return { profileId };
};

export const isSandboxToolIdentifier = (identifier?: string | null) =>
  !!parseSandboxToolIdentifier(identifier);

/** Maps the legacy `python` API to `runPython`; others pass through. */
export const resolveSandboxApiName = (apiName: string) =>
  apiName === LegacyPythonApiName ? SandboxApiName.runPython : apiName;
