/**
 * Official xAI Console API plus SuperGrok device-code OAuth overlay.
 * @see https://docs.x.ai/developers/rest-api-reference/inference
 * @see https://docs.x.ai/developers/advanced-api-usage/prompt-caching
 */

export const XAI_API_BASE_URL = 'https://api.x.ai/v1';
export const XAI_OAUTH_AUTH_MODE = 'xai-oauth';
export const XAI_OAUTH_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
export const XAI_OAUTH_BILLING_URL = `${XAI_OAUTH_BASE_URL}/billing?format=credits`;
export const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const XAI_OAUTH_CLIENT_MODE = 'cli';
export const XAI_OAUTH_CLIENT_VERSION = '1.0.4';
export const XAI_OAUTH_DEVICE_TIMEOUT_MS = 5 * 60 * 1000;
export const XAI_OAUTH_DISCOVERY_URL = 'https://auth.x.ai/.well-known/openid-configuration';
export const XAI_OAUTH_HANDOFF_CLIENT = 'xai-oauth';
export const XAI_OAUTH_ISSUER = 'https://auth.x.ai';
export const XAI_OAUTH_LEGACY_TOKEN_ENDPOINT = `${XAI_OAUTH_ISSUER}/oauth/token`;
export const XAI_OAUTH_REFRESH_SKEW_MS = 60 * 1000;
export const XAI_OAUTH_REFRESH_TIMEOUT_MS = 30 * 1000;
export const XAI_OAUTH_SCOPE = 'openid profile email offline_access grok-cli:access api:access';
export const XAI_OAUTH_USAGE_TIMEOUT_MS = 15_000;
export const XAI_OAUTH_USER_AGENT = 'ChatHub/xai-oauth';
export const XAI_DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
export const XAI_DEVICE_CODE_DEFAULT_INTERVAL_MS = 5 * 1000;
export const XAI_DEVICE_CODE_MIN_INTERVAL_MS = 1 * 1000;
export const XAI_DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5 * 1000;
export const XAI_DEVICE_CODE_TOKEN_TIMEOUT_MS = 15 * 1000;

export const XAI_OAUTH_CLIENT_HEADERS = {
  'x-grok-client-mode': XAI_OAUTH_CLIENT_MODE,
  'x-grok-client-version': XAI_OAUTH_CLIENT_VERSION,
} as const;

export const isTrustedXaiOAuthHost = (hostname: string): boolean =>
  hostname === 'x.ai' || hostname.endsWith('.x.ai');
