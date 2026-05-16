import debug from 'debug';

/**
 * CHATHUB_DEBUG=1 only controls Pino log level.
 *
 * We do NOT auto-enable any debug() namespaces because the codebase contains
 * 70+ debug loggers, many of which use %O/%o to print full objects that can
 * include user data, auth tokens, API keys, prompts, responses, file contents,
 * JWTs, and session payloads. Auditing every line is error-prone and breaks
 * whenever new debug sites are added.
 *
 * Users who want specific debug namespaces should use the standard DEBUG=...
 * environment variable (e.g. DEBUG=lobe-async:*,lobe-server:discover).
 */
export function bootstrapDebug() {
  if (process.env.CHATHUB_DEBUG !== '1') return;

  // Preserve any explicitly-set DEBUG namespaces; do not add our own.
  const existing = process.env.DEBUG || '';
  if (existing) {
    debug.enable(existing);
  }
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
