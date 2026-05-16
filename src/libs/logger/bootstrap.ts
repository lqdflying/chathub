import debug from 'debug';

/**
 * Namespace wildcards matching all actual debug() instances in the codebase.
 * These are intentionally broad to cover existing and future debug loggers
 * without requiring a manual whitelist update every time a new namespace is added.
 */
export const CHATHUB_DEBUG_NAMESPACES = [
  'lobe-*',
  'model-runtime:*',
  'context-engine:*',
  'file-loaders:*',
  'electron-server-ipc:*',
  'config-router',
  'oidc-jwt',
  'utils:*',
  'lambda-router:*',
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
