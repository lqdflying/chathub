import { BODY_METHODS } from './constants';
import type { ApiTesterProxyRequest, ApiTesterRequestDraft, AuthType } from './types';

const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const hasHeader = (headers: Record<string, string>, key: string): boolean => {
  const normalized = key.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === normalized);
};

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
 * Returns undefined if auth type is 'none' / 'apikey' or required fields are empty.
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
    return `Basic ${toBase64(`${username}:${password}`)}`;
  }
  return undefined;
};

export const buildRequestHeaders = (
  draft: ApiTesterRequestDraft,
  contentType?: string,
): Record<string, string> => {
  const requestHeaders: Record<string, string> = {};

  for (const h of draft.headers) {
    if (h.enabled && h.key.trim()) {
      requestHeaders[h.key.trim()] = h.value;
    }
  }

  const authHeader = buildAuthHeader(
    draft.authType,
    draft.bearerToken,
    draft.basicUsername,
    draft.basicPassword,
  );
  if (authHeader) requestHeaders['Authorization'] = authHeader;

  if (
    draft.authType === 'apikey' &&
    draft.apiKeyLocation === 'header' &&
    draft.apiKeyName.trim() &&
    draft.apiKeyValue.trim()
  ) {
    requestHeaders[draft.apiKeyName.trim()] = draft.apiKeyValue.trim();
  }

  if (contentType && !hasHeader(requestHeaders, 'Content-Type')) {
    requestHeaders['Content-Type'] = contentType;
  }

  return requestHeaders;
};

/**
 * Appends an API key as a query parameter, tolerating URLs that the URL
 * constructor cannot parse (falls back to manual string concatenation).
 */
const appendQueryApiKey = (url: string, name: string, value: string): string => {
  try {
    const parsed = new URL(url);
    parsed.searchParams.append(name, value);
    return parsed.toString();
  } catch {
    const hashIndex = url.indexOf('#');
    const beforeFragment = hashIndex < 0 ? url : url.slice(0, hashIndex);
    const fragment = hashIndex < 0 ? '' : url.slice(hashIndex);
    const separator = beforeFragment.includes('?') ? '&' : '?';
    return `${beforeFragment}${separator}${encodeURIComponent(name)}=${encodeURIComponent(
      value,
    )}${fragment}`;
  }
};

export const buildProxyRequestPayload = (draft: ApiTesterRequestDraft): ApiTesterProxyRequest => {
  const hasBody = BODY_METHODS.has(draft.method);
  const requestBody = hasBody && draft.body.trim() ? draft.body : undefined;

  let url = draft.url.trim();
  if (
    draft.authType === 'apikey' &&
    draft.apiKeyLocation === 'query' &&
    draft.apiKeyName.trim() &&
    draft.apiKeyValue.trim()
  ) {
    url = appendQueryApiKey(url, draft.apiKeyName.trim(), draft.apiKeyValue.trim());
  }

  return {
    body: requestBody,
    headers: buildRequestHeaders(draft, requestBody ? draft.contentType : undefined),
    method: draft.method,
    url,
  };
};

/**
 * Pretty-prints JSON string with 2-space indentation.
 * Throws SyntaxError if input is not valid JSON.
 */
export const formatJson = (text: string): string => {
  return JSON.stringify(JSON.parse(text), null, 2);
};

/**
 * Byte length of a response body (UTF-8).
 */
export const getResponseSize = (body: string): number => {
  return new TextEncoder().encode(body).length;
};

/**
 * Picks a syntax-highlighting language for the response body based on the
 * Content-Type header, falling back to sniffing the body itself.
 */
export const detectHighlightLanguage = (
  contentType: string,
  body: string,
): 'html' | 'json' | 'text' | 'xml' => {
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'html';
  if (ct.includes('xml')) return 'xml';

  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      /* not JSON */
    }
  }
  return 'text';
};
