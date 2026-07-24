import debug from 'debug';

/**
 * CHATHUB_DEBUG=1 only controls Pino log level. It does NOT auto-enable any
 * debug() namespaces.
 *
 * CHATHUB_TOOLS_DEBUG is a single server-side switch for prefixed JSON MCP and
 * tool diagnostics, selected by the var's value:
 *
 * - unset / empty / 0 / false / off  → off
 * - 1 / true / on / safe             → safe metadata records
 * - verbose / 2                      → safe metadata + payload fingerprints
 *
 * Existing chathub-tools, lobe-mcp, and context-engine debug() namespaces
 * remain explicit DEBUG opt-ins. The structured logger uses the environment
 * switch directly and does not auto-enable or duplicate those namespaces.
 *
 * Namespaces that log raw user input or secrets are never auto-enabled here:
 * `lobe-search:*` (raw search queries), `lobe-chat:*` (client store debug),
 * and provider raw-stream flags (DEBUG_OPENAI_*, DEBUG_OPENAICOMPATIBLE_*,
 * etc.). Enable those explicitly via DEBUG=... only when actively debugging.
 */

export type StructuredDebugLevel = 'off' | 'safe' | 'verbose';
export type ToolsDebugLevel = StructuredDebugLevel;
export type ImageDebugLevel = StructuredDebugLevel;

/**
 * Legacy safe namespace, retained as an explicit DEBUG fallback when the
 * structured environment switch does not already emit an event.
 */
export const TOOLS_SAFE_NS: readonly string[] = ['chathub-tools:safe'];

/** Legacy verbose namespace; values are fingerprints, lengths, and bounded structure. */
export const TOOLS_VERBOSE_NS: readonly string[] = ['chathub-tools:verbose'];

const OFF_VALUES = new Set(['', '0', 'false', 'off']);
const SAFE_VALUES = new Set(['1', 'true', 'on', 'safe']);
const VERBOSE_VALUES = new Set(['2', 'verbose']);
let imageDebugConfigWarningLogged = false;

const parseStructuredDebugLevel = (raw: string | undefined): StructuredDebugLevel => {
  const v = (raw ?? '').trim().toLowerCase();
  if (OFF_VALUES.has(v)) return 'off';
  if (SAFE_VALUES.has(v)) return 'safe';
  if (VERBOSE_VALUES.has(v)) return 'verbose';
  return 'off';
};

const isRecognizedStructuredDebugValue = (raw: string | undefined): boolean => {
  const v = (raw ?? '').trim().toLowerCase();
  return OFF_VALUES.has(v) || SAFE_VALUES.has(v) || VERBOSE_VALUES.has(v);
};

/**
 * Parse CHATHUB_TOOLS_DEBUG into a level. Case-insensitive and trimmed.
 * Unknown values return 'off' — the caller (bootstrapDebug) warns once so a
 * typo does not silently disable diagnostics.
 */
export const parseToolsDebugLevel = (raw: string | undefined): ToolsDebugLevel =>
  parseStructuredDebugLevel(raw);

/**
 * Parse CHATHUB_IMAGE_DEBUG into a level. Case-insensitive and trimmed.
 * Unknown values return 'off' and bootstrapDebug emits a structured warning.
 */
export const parseImageDebugLevel = (raw: string | undefined): ImageDebugLevel =>
  parseStructuredDebugLevel(raw);

const isRecognizedToolsDebugValue = isRecognizedStructuredDebugValue;
const isRecognizedImageDebugValue = isRecognizedStructuredDebugValue;

const writeImageDebugConfigWarning = () => {
  if (imageDebugConfigWarningLogged) return;
  imageDebugConfigWarningLogged = true;

  try {
    // eslint-disable-next-line no-console
    console.log(
      '[chathub-image-debug:config_warning]',
      JSON.stringify({
        debugLevel: 'safe',
        outcome: 'warning',
        phase: 'configuration',
        reason: 'unrecognized_debug_value',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        valueLength: process.env.CHATHUB_IMAGE_DEBUG?.length ?? 0,
      }),
    );
  } catch {
    // Diagnostics must never interrupt app startup.
  }
};

/**
 * Build the explicitly-set DEBUG namespace list, deduped. Tool namespaces are
 * no longer added from CHATHUB_TOOLS_DEBUG because that switch emits JSON.
 */
const buildNamespaceList = (): string[] => {
  const explicit = (process.env.DEBUG || '')
    .split(',')
    .map((ns) => ns.trim())
    .filter(Boolean);

  return [...new Set(explicit)];
};

export function bootstrapDebug() {
  // Warn once on an unrecognized CHATHUB_TOOLS_DEBUG value so typos are visible.
  if (!isRecognizedToolsDebugValue(process.env.CHATHUB_TOOLS_DEBUG)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bootstrap] Unrecognized CHATHUB_TOOLS_DEBUG value "${process.env.CHATHUB_TOOLS_DEBUG}"; treating as off. Use 1 (safe) or verbose.`,
    );
  }

  // Warn once on an unrecognized CHATHUB_IMAGE_DEBUG value without emitting the
  // raw value. Image diagnostics are structured-only and remain off for typos.
  if (!isRecognizedImageDebugValue(process.env.CHATHUB_IMAGE_DEBUG)) {
    writeImageDebugConfigWarning();
  }

  const namespaces = buildNamespaceList();
  if (namespaces.length > 0) {
    debug.enable(namespaces.join(','));
  }
}

/**
 * Determine the Pino log level.
 * Explicit LOG_LEVEL always wins. CHATHUB_TOOLS_DEBUG deliberately does not
 * lower the global Pino threshold.
 */
export function getPinoLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (process.env.CHATHUB_DEBUG === '1') return 'debug';
  return 'info';
}
