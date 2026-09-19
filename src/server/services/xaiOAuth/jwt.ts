type XaiJwtIdentity = {
  email?: string;
  exp?: number;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const decodeXaiJwtPayload = (token?: string): Record<string, unknown> => {
  if (!token) return {};
  const segment = token.split('.')[1];
  if (!segment) return {};
  try {
    return asRecord(JSON.parse(Buffer.from(segment, 'base64url').toString('utf8') || '{}'));
  } catch {
    return {};
  }
};

export const resolveXaiOAuthJwtIdentity = (token?: string): XaiJwtIdentity | undefined => {
  const payload = decodeXaiJwtPayload(token);
  const email =
    asOptionalString(payload.email) ||
    asOptionalString(payload.preferred_username) ||
    asOptionalString(payload.upn);
  const exp = typeof payload.exp === 'number' && payload.exp > 0 ? payload.exp : undefined;
  if (!email && !exp) return undefined;
  return { email, exp };
};
