/**
 * CHATHUB_XAI_OAUTH_DEBUG — prefixed JSON for SuperGrok device OAuth and
 * cli-chat-proxy billing. Value semantics match CHATHUB_OPENAI_CODEX_DEBUG
 * (unset/0/false/off → off; 1/true/on/safe → on). Never logs tokens, device
 * codes, emails, prompts, or response text.
 */

const OFF_VALUES = new Set(['', '0', 'false', 'off']);
const ON_VALUES = new Set(['1', 'true', 'on', 'safe', '2', 'verbose']);
const SAFE_STRING_KEY =
  /^(?:errorClass|kind|operation|outcome|phase|provider|reason|status)$/;
const SAFE_STRING_VALUE = /^[A-Za-z][\w+./:-]{0,63}$/;

export const XAI_OAUTH_DEBUG_NAMESPACE = 'chathub-xai-oauth-debug';

export type XaiOAuthDebugEvent =
  | 'device_login_settled'
  | 'device_poll_settled'
  | 'logout_settled'
  | 'models_fetch_settled'
  | 'refresh_settled'
  | 'resolve_overlay_settled'
  | 'resolve_session_settled'
  | 'token_exchange_settled'
  | 'usage_fetch_settled';

export const isXaiOAuthDebugEnabled = (): boolean => {
  const value = (process.env.CHATHUB_XAI_OAUTH_DEBUG ?? '').trim().toLowerCase();
  return ON_VALUES.has(value) && !OFF_VALUES.has(value);
};

export const describeXaiOAuthErrorClass = (error: unknown): string => {
  if (error instanceof Error && /^\w{1,64}$/.test(error.name)) return error.name;
  return 'Error';
};

const isSafeDebugValue = (key: string, value: unknown): boolean => {
  if (typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value !== 'string') return false;
  return SAFE_STRING_KEY.test(key) && SAFE_STRING_VALUE.test(value);
};

export const logXaiOAuthDebugSafe = (
  event: XaiOAuthDebugEvent,
  fields: Record<string, unknown> = {},
) => {
  if (!isXaiOAuthDebugEnabled()) return;

  const safeFields = Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => isSafeDebugValue(key, value)),
  );

  console.info(`[${XAI_OAUTH_DEBUG_NAMESPACE}:${event}] ${JSON.stringify(safeFields)}`);
};
