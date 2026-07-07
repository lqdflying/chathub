export type AuthType = 'basic' | 'bearer' | 'none';

export interface ApiTesterHeaderRow {
  enabled: boolean;
  key: string;
  value: string;
}

export interface ApiTesterProxyRequest {
  body?: string;
  headers?: Record<string, string>;
  method: string;
  url: string;
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Validates that a URL starts with http:// or https://
 */
export const isValidUrl = (url: string): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Builds the Authorization header value based on auth type.
 * Returns undefined if auth type is 'none' or required fields are empty.
 */
export const buildAuthHeader = (
  type: AuthType,
  token: string,
  username: string,
  password: string,
): string | undefined => {
  if (type === 'bearer') {
    return token.trim() ? `Bearer ${token.trim()}` : undefined;
  }
  if (type === 'basic') {
    if (!username && !password) return undefined;
    return `Basic ${btoa(`${username}:${password}`)}`;
  }
  return undefined;
};

export const buildRequestHeaders = (
  rows: ApiTesterHeaderRow[],
  authType: AuthType,
  bearerToken: string,
  basicUsername: string,
  basicPassword: string,
  contentType?: string,
): Record<string, string> => {
  const requestHeaders: Record<string, string> = {};

  for (const h of rows) {
    if (h.enabled && h.key.trim()) {
      requestHeaders[h.key.trim()] = h.value;
    }
  }

  const authHeader = buildAuthHeader(authType, bearerToken, basicUsername, basicPassword);
  if (authHeader) requestHeaders['Authorization'] = authHeader;
  if (contentType) requestHeaders['Content-Type'] = contentType;

  return requestHeaders;
};

export const buildProxyRequestPayload = ({
  authType,
  basicPassword,
  basicUsername,
  bearerToken,
  body,
  contentType,
  headers,
  method,
  url,
}: {
  authType: AuthType;
  basicPassword: string;
  basicUsername: string;
  bearerToken: string;
  body: string;
  contentType: string;
  headers: ApiTesterHeaderRow[];
  method: string;
  url: string;
}): ApiTesterProxyRequest => {
  const hasBody = BODY_METHODS.has(method);
  const requestBody = hasBody && body.trim() ? body : undefined;

  return {
    body: requestBody,
    headers: buildRequestHeaders(
      headers,
      authType,
      bearerToken,
      basicUsername,
      basicPassword,
      requestBody ? contentType : undefined,
    ),
    method,
    url: url.trim(),
  };
};

/**
 * Pretty-prints JSON string with 2-space indentation.
 * Throws SyntaxError if input is not valid JSON.
 */
export const formatJson = (text: string): string => {
  return JSON.stringify(JSON.parse(text), null, 2);
};
