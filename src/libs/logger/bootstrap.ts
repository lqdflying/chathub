import debug from 'debug';

/**
 * Namespaces enabled when CHATHUB_DEBUG=1.
 *
 * We use an explicit allowlist instead of a broad wildcard because several
 * existing debug loggers print sensitive payloads (tokens, API keys, prompts,
 * responses, user data, JWTs). Only audited-safe namespaces are listed.
 *
 * Known-sensitive namespaces that are deliberately NOT included:
 *   - context-engine:*        – logs system roles, input templates, vision descriptions
 *   - lobe-image:*            – logs image prompts, URLs, generation params
 *   - lobe-lambda-router:*    – logs structured-output schema and generated results
 *   - lobe-mcp:client         – logs tool arguments and return values
 *   - lobe-model-runtime:*    – logs model prompts / responses / tool inputs
 *   - lobe-oidc:adapter       – logs full OIDC session / payload objects
 *   - lobe-oidc:http-adapter  – logs parsed request bodies
 *   - lobe-oidc:provider      – logs provider-level OIDC data
 *   - lobe-search:*           – logs search request bodies (may contain API keys)
 *   - lobe-next-auth:adapter  – logs adapter payloads
 *   - oidc-jwt                – logs JWT payloads
 */
export const CHATHUB_DEBUG_NAMESPACES = [
  // Async / tRPC — operational logs, no user data
  'lobe-async:*',
  'lobe-trpc:*',

  // MCP server-side — safe operational namespaces only
  'lobe-mcp:deps-check',
  'lobe-mcp:oauth-discovery',
  'lobe-mcp:oauth-service',
  'lobe-mcp:router',
  'lobe-mcp:service',

  // OIDC — safe sub-namespaces only
  'lobe-oidc:callback:desktop',
  'lobe-oidc:consent',
  'lobe-oidc:correctOIDCUrl',
  'lobe-oidc:handoff',
  'lobe-oidc:interaction-policy',
  'lobe-oidc:route',
  'lobe-oidc:service',
  'lobe-oidc:validateRedirectHost',

  // Auth — safe API endpoint only
  'lobe-next-auth:api:auth:adapter',

  // Server services / feature flags / config
  'lobe-server:discover',
  'lobe-feature-flags',
  'config-router',

  // UI / React / Markdown — safe component logs
  'lobe-markdown:*',
  'lobe-react:*',

  // Cost calculations — numbers only
  'lobe-cost:*',

  // Chat — safe operational logs only
  'lobe-chat:group-chat',
  'lobe-chat:supervisor',

  // Non-lobe namespaces (no known sensitive data)
  'electron-server-ipc:*',
  'file-loaders:*',
  'lambda-router:*',
  'model-runtime:*',
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
