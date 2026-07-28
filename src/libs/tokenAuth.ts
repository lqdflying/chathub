const DEFAULT_TOKEN_AUTH_USER_ID = 'default_user';
const MAX_AUTH_TOKEN_BYTES = 4096;

export const secureCompareStrings = (providedValue: string, expectedValue: string): boolean => {
  if (providedValue.length > MAX_AUTH_TOKEN_BYTES || expectedValue.length > MAX_AUTH_TOKEN_BYTES) {
    return false;
  }

  const encoder = new TextEncoder();
  const providedBytes = encoder.encode(providedValue);
  const expectedBytes = encoder.encode(expectedValue);

  if (providedBytes.length > MAX_AUTH_TOKEN_BYTES || expectedBytes.length > MAX_AUTH_TOKEN_BYTES) {
    return false;
  }

  let difference = providedBytes.length ^ expectedBytes.length;

  for (let byteIndex = 0; byteIndex < MAX_AUTH_TOKEN_BYTES; byteIndex++) {
    difference |= (providedBytes[byteIndex] ?? 0) ^ (expectedBytes[byteIndex] ?? 0);
  }

  return difference === 0;
};

const parseBearerToken = (authorizationHeader: string | null): string | undefined => {
  if (!authorizationHeader) return undefined;

  const match = /^bearer (\S+)$/i.exec(authorizationHeader);
  return match?.[1];
};

export const resolveTokenAuthUserId = (
  headers: Pick<Headers, 'get'>,
  configuration: {
    expectedToken?: string;
    userId?: string;
  } = {},
): string | undefined => {
  const expectedToken = configuration.expectedToken ?? process.env.AUTH_TOKEN;
  if (!expectedToken) return undefined;

  const providedToken = parseBearerToken(headers.get('Authorization'));
  if (!providedToken || !secureCompareStrings(providedToken, expectedToken)) return undefined;

  return configuration.userId ?? process.env.AUTH_USER_ID ?? DEFAULT_TOKEN_AUTH_USER_ID;
};
