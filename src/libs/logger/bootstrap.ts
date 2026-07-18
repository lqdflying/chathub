import debug from 'debug';

/**
 * CHATHUB_DEBUG=1 only controls Pino log level. It does NOT auto-enable any
 * debug() namespaces.
 *
 * CHATHUB_TOOLS_DEBUG is a single server-side switch that auto-enables a
 * curated, PII-safe set of MCP and built-in tool debug() namespaces, selected
 * by the var's value:
 *
 * - unset / empty / 0 / false / off  → off (no auto-enable; behaves as before)
 * - 1 / true / on / safe             → dedicated safe metadata namespace
 * - verbose / 2                      → safe metadata + payload fingerprints
 *
 * Only dedicated ChatHub namespaces are auto-enabled. Existing lobe-mcp and
 * context-engine namespaces remain explicit DEBUG opt-ins because their log
 * contracts are broader and can include user-controlled strings.
 *
 * Namespaces that log raw user input or secrets are never auto-enabled here:
 * `lobe-search:*` (raw search queries), `lobe-chat:*` (client store debug),
 * and provider raw-stream flags (DEBUG_OPENAI_*, DEBUG_OPENAICOMPATIBLE_*,
 * etc.). Enable those explicitly via DEBUG=... only when actively debugging.
 */

export type ToolsDebugLevel = 'off' | 'safe' | 'verbose';

/**
 * Curated safe namespaces: sanitized params / counts / IDs / timing only.
 * Auditable in one place — do not add a namespace without verifying it never
 * logs raw user input, prompts, secrets, or full request/response bodies.
 */
export const TOOLS_SAFE_NS: readonly string[] = ['chathub-tools:safe'];

/** Added only at the verbose level; values are fingerprints, lengths, and bounded structure. */
export const TOOLS_VERBOSE_NS: readonly string[] = ['chathub-tools:verbose'];

const OFF_VALUES = new Set(['', '0', 'false', 'off']);
const SAFE_VALUES = new Set(['1', 'true', 'on', 'safe']);
const VERBOSE_VALUES = new Set(['2', 'verbose']);

/**
 * Parse CHATHUB_TOOLS_DEBUG into a level. Case-insensitive and trimmed.
 * Unknown values return 'off' — the caller (bootstrapDebug) warns once so a
 * typo does not silently disable diagnostics.
 */
export const parseToolsDebugLevel = (raw: string | undefined): ToolsDebugLevel => {
  const v = (raw ?? '').trim().toLowerCase();
  if (OFF_VALUES.has(v)) return 'off';
  if (SAFE_VALUES.has(v)) return 'safe';
  if (VERBOSE_VALUES.has(v)) return 'verbose';
  return 'off';
};

const isRecognizedToolsDebugValue = (raw: string | undefined): boolean => {
  const v = (raw ?? '').trim().toLowerCase();
  return OFF_VALUES.has(v) || SAFE_VALUES.has(v) || VERBOSE_VALUES.has(v);
};

/**
 * Build the merged namespace list: any explicitly-set DEBUG namespaces plus
 * the curated set(s) selected by the CHATHUB_TOOLS_DEBUG level, deduped.
 */
const buildNamespaceList = (level: ToolsDebugLevel): string[] => {
  const explicit = (process.env.DEBUG || '')
    .split(',')
    .map((ns) => ns.trim())
    .filter(Boolean);

  const curated =
    level === 'safe' ? [...TOOLS_SAFE_NS] : level === 'verbose' ? [...TOOLS_SAFE_NS, ...TOOLS_VERBOSE_NS] : [];

  // Explicit DEBUG namespaces win; dedupe while preserving order.
  return [...new Set([...explicit, ...curated])];
};

export function bootstrapDebug() {
  const level = parseToolsDebugLevel(process.env.CHATHUB_TOOLS_DEBUG);

  // Warn once on an unrecognized CHATHUB_TOOLS_DEBUG value so typos are visible.
  if (!isRecognizedToolsDebugValue(process.env.CHATHUB_TOOLS_DEBUG)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bootstrap] Unrecognized CHATHUB_TOOLS_DEBUG value "${process.env.CHATHUB_TOOLS_DEBUG}"; treating as off. Use 1 (safe) or verbose.`,
    );
  }

  const namespaces = buildNamespaceList(level);
  if (namespaces.length > 0) {
    debug.enable(namespaces.join(','));
  }
}

/**
 * Determine the Pino log level.
 * Explicit LOG_LEVEL always wins. CHATHUB_TOOLS_DEBUG uses debug() namespaces
 * and deliberately does not lower the global Pino threshold.
 */
export function getPinoLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (process.env.CHATHUB_DEBUG === '1') return 'debug';
  return 'info';
}
