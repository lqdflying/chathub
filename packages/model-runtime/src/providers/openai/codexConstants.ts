/** Public Codex CLI OAuth client used by the unofficial ChatGPT subscription path. */
export const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

export const OPENAI_AUTH_BASE_URL = 'https://auth.openai.com';

export const OPENAI_CODEX_DEVICE_VERIFICATION_URL = 'https://auth.openai.com/codex/device';

export const OPENAI_CODEX_DEVICE_CALLBACK_URL = 'https://auth.openai.com/deviceauth/callback';

/** Codex inference / catalog base (no trailing slash). */
export const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

/**
 * Official Codex CLI ChatGPT path for live 5-hour / weekly remaining.
 * @see https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs
 */
export const OPENAI_CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

export const OPENAI_CODEX_USAGE_TIMEOUT_MS = 8000;

/** Pinned to a current Codex CLI version for `GET /models?client_version=`. */
export const OPENAI_CODEX_CLIENT_VERSION = '0.154.0';

export const OPENAI_CODEX_AUTH_MODE = 'codex-oauth';

export const OPENAI_CODEX_ORIGINATOR = 'chathub';

export const OPENAI_CODEX_USER_AGENT = 'ChatHub';

export const OPENAI_CODEX_HANDOFF_CLIENT = 'openai-codex-device';

export const OPENAI_CODEX_DEVICE_TIMEOUT_MS = 15 * 60 * 1000;

export const OPENAI_CODEX_REFRESH_SKEW_MS = 5 * 60 * 1000;
