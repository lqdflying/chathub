import { createMCPError } from './types';
import type { MCPTokenGetter } from './types';

const EMPTY_RESPONSE_STATUSES = new Set([202, 204, 205, 304]);

const createResponseValidationError = (response: Response, reason: 'html' | 'invalid_json') => {
  const contentType = response.headers.get('content-type') || 'unknown';
  const reasonLabel = reason === 'html' ? 'an unexpected HTML document' : 'invalid JSON';

  return createMCPError(
    'CONNECTION_FAILED',
    `MCP server returned ${reasonLabel} (HTTP ${response.status}, content-type ${contentType}).`,
    { step: 'http_response_validation' },
  );
};

const createAuthorizationError = () =>
  createMCPError(
    'AUTHORIZATION_ERROR',
    'MCP server rejected the OAuth credentials (HTTP 401).',
    { step: 'http_authorization' },
  );

const isHTMLDocument = (body: string): boolean => {
  const normalizedBody = body.trimStart().toLowerCase();

  return normalizedBody.startsWith('<!doctype html') || normalizedBody.startsWith('<html');
};

const stripResponseBody = (response: Response): Response => {
  return new Response(null, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
};

export const sanitizeMCPURLForLogging = (url: string): string => {
  try {
    const parsedUrl = new URL(url);

    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    return '[invalid MCP URL]';
  }
};

export const validateMCPHTTPResponse = async (response: Response): Promise<Response> => {
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  if (contentType.includes('text/event-stream')) {
    return response.ok ? response : stripResponseBody(response);
  }

  const responseBody = await response.clone().text();
  if (contentType.includes('text/html') || isHTMLDocument(responseBody)) {
    throw createResponseValidationError(response, 'html');
  }
  if (!response.ok) return stripResponseBody(response);
  if (EMPTY_RESPONSE_STATUSES.has(response.status)) return response;
  if (!contentType.includes('application/json')) return response;

  try {
    JSON.parse(responseBody);
  } catch {
    throw createResponseValidationError(response, 'invalid_json');
  }

  return response;
};

export const createMCPValidatingFetch = (fetchFn: typeof fetch = fetch): typeof fetch => {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetchFn(input, init);

    return validateMCPHTTPResponse(response);
  }) as typeof fetch;
};

interface MCPAuthenticatedFetchOptions {
  fetchFn?: typeof fetch;
  initialAccessToken?: string;
  tokenGetter?: MCPTokenGetter;
}

export const createMCPAuthenticatedFetch = ({
  fetchFn = fetch,
  initialAccessToken,
  tokenGetter,
}: MCPAuthenticatedFetchOptions): typeof fetch => {
  let accessToken = initialAccessToken;
  let initialTokenPromise: Promise<string | undefined> | undefined;
  let refreshPromise: Promise<string | undefined> | undefined;

  const getInitialAccessToken = async (): Promise<string | undefined> => {
    if (accessToken || !tokenGetter) return accessToken;

    initialTokenPromise ??= tokenGetter().finally(() => {
      initialTokenPromise = undefined;
    });
    accessToken = await initialTokenPromise;

    return accessToken;
  };

  const forceRefreshAccessToken = async (): Promise<string | undefined> => {
    if (!tokenGetter) return undefined;

    refreshPromise ??= tokenGetter({ forceRefresh: true }).finally(() => {
      refreshPromise = undefined;
    });
    const refreshedAccessToken = await refreshPromise;
    if (refreshedAccessToken) accessToken = refreshedAccessToken;

    return refreshedAccessToken;
  };

  const fetchWithAccessToken = async (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    requestAccessToken: string | undefined,
  ): Promise<Response> => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));

    if (requestAccessToken) {
      headers.set('Authorization', `Bearer ${requestAccessToken}`);
    }

    return fetchFn(input, { ...init, headers });
  };

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestAccessToken = await getInitialAccessToken();
    let response = await fetchWithAccessToken(input, init, requestAccessToken);

    if (response.status !== 401) {
      return validateMCPHTTPResponse(response);
    }

    if (!tokenGetter) return validateMCPHTTPResponse(response);

    const replacementAccessToken =
      accessToken && accessToken !== requestAccessToken
        ? accessToken
        : await forceRefreshAccessToken();

    if (!replacementAccessToken) throw createAuthorizationError();

    response = await fetchWithAccessToken(input, init, replacementAccessToken);
    if (response.status === 401) throw createAuthorizationError();

    return validateMCPHTTPResponse(response);
  }) as typeof fetch;
};
