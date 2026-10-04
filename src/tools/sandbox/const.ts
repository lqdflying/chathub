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

export const isSandboxToolIdentifier = (identifier?: string | null) =>
  identifier === SandboxIdentifier || identifier === LegacyCodeInterpreterIdentifier;

/** Maps the legacy `python` API to `runPython`; others pass through. */
export const resolveSandboxApiName = (apiName: string) =>
  apiName === LegacyPythonApiName ? SandboxApiName.runPython : apiName;
