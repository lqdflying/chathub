const OPENAI_CODEX_AUTH_CLAIM = 'https://api.openai.com/auth';
const OPENAI_CODEX_PROFILE_CLAIM = 'https://api.openai.com/profile';

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export type OpenAICodexJwtIdentity = {
  accountId: string;
  chatgptPlanType?: string;
  email?: string;
};

export const decodeJwtPayload = (token: string): Record<string, unknown> | undefined => {
  const payload = token.split('.')[1];
  if (!payload) return undefined;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
};

export const resolveOpenAICodexJwtIdentity = (
  accessToken: string,
): OpenAICodexJwtIdentity | undefined => {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return undefined;

  const auth = asRecord(payload[OPENAI_CODEX_AUTH_CLAIM]);
  const profile = asRecord(payload[OPENAI_CODEX_PROFILE_CLAIM]);
  const accountId = asOptionalString(auth.chatgpt_account_id);
  if (!accountId) return undefined;

  return {
    accountId,
    chatgptPlanType: asOptionalString(auth.chatgpt_plan_type),
    email: asOptionalString(profile.email) ?? asOptionalString(payload.email),
  };
};
