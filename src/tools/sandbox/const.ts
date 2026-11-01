export const SandboxIdentifier = 'lobe-sandbox';

/**
 * The Sandbox tool was the Code Interpreter. Its identifier is still stored on
 * old tool messages and, until migrated, in agent plugin lists.
 */
export const LegacyCodeInterpreterIdentifier = 'lobe-code-interpreter';

export const SandboxApiName = {
  editFile: 'editFile',
  exportFile: 'exportFile',
  getCommandOutput: 'getCommandOutput',
  listFiles: 'listFiles',
  readFile: 'readFile',
  runCommand: 'runCommand',
  runPython: 'runPython',
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

/**
 * Keeps `lobe-sandbox--<id>____<api>____builtin` under 64 characters, the
 * point where ToolNameResolver hashes names. The durable worker splits tool
 * names on `____` and cannot undo that hash.
 */
export const SANDBOX_PROFILE_ID_MAX_LENGTH = 16;

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
