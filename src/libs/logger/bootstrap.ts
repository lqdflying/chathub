import debug from 'debug';

/**
 * Namespaces enabled when CHATHUB_DEBUG=1.
 *
 * We intentionally avoid a blanket `lobe-*` wildcard because several existing
 * `lobe-*` loggers print sensitive payloads (tokens, API keys, prompts,
 * responses, user data). Instead we use a broad base (`lobe-*`) with explicit
 * exclusions (`-`) for the known-sensitive areas, plus additional safe
 * non-lobe namespaces.
 *
 * Excluded namespaces (and why):
 *   - lobe-oidc:adapter   – logs full OIDC session / payload objects
 *   - lobe-mcp:client     – logs tool arguments and return values
 *   - lobe-search:*       – logs search request bodies (may contain API keys)
 *   - lobe-model-runtime:* – logs model prompts / responses / tool inputs
 */
export const CHATHUB_DEBUG_NAMESPACES = [
  'lobe-*',
  '-lobe-mcp:client',
  '-lobe-model-runtime:*',
  '-lobe-oidc:adapter',
  '-lobe-search:*',
  'context-engine:*',
  'electron-server-ipc:*',
  'file-loaders:*',
  'lambda-router:*',
  'config-router',
  'oidc-jwt',
  'utils:*',
].join(',');

/**
 * Idempotently enable debug namespaces when CHATHUB_DEBUG=1.
 * Merges with any existing DEBUG env value instead of overwriting it.
 * Safe to call multiple times.
 */
export function bootstrapDebug() {
  if (process.env.CHATHUB_DEBUG !== '1') return;

  const existing = process.env.DEBUG || '';
  const merged = [existing, CHATHUB_DEBUG_NAMESPACES].filter(Boolean).join(',');

  debug.enable(merged);
}

/**
 * Determine the Pino log level.
 * Explicit LOG_LEVEL always wins. When CHATHUB_DEBUG=1 and no LOG_LEVEL is set,
 * default to 'debug'. Otherwise default to 'info'.
 */
export function getPinoLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  return process.env.CHATHUB_DEBUG === '1' ? 'debug' : 'info';
}
