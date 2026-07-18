import {
  describeToolsDebugError,
  fingerprintToolsDebugString,
  logToolsDebugSafe,
} from '@/libs/logger/toolsDebug';

import { createMCPError } from './types';
import type { MCPTokenGetter } from './types';

type FetchInit = Parameters<typeof fetch>[1];
type FetchInput = Parameters<typeof fetch>[0];

const EMPTY_RESPONSE_STATUSES = new Set([202, 204, 205, 304]);

const removeControlCharacters = (value: string) =>
  [...value]
    .filter((character) => {
      const code = character.codePointAt(0) || 0;
      return code > 31 && code !== 127;
    })
    .join('');

const normalizeMediaType = (value: string | null) => {
  const mediaType = value?.split(';', 1)[0].trim().toLowerCase();
  return mediaType &&
    mediaType.length <= 120 &&
    /^[\w!#$%&'*+.^`|~-]+\/[\w!#$%&'*+.^`|~-]+$/.test(mediaType)
    ? mediaType
    : undefined;
};

const isSecretShapedPathSegment = (segment: string) => {
  if (segment.includes('%')) return true;
  if (/token|secret|password|api[_-]?key|credential/i.test(segment)) return true;
  if (/^(?:sk[_-]|pk[_-]|eyj)/i.test(segment)) return true;
  if (segment.length < 24 || !/^[\w+.~-]+$/.test(segment)) return false;

  return (
    /\d/.test(segment) ||
    (/[A-Z]/.test(segment) && /[a-z]/.test(segment)) ||
    !/[+._~-]/.test(segment)
  );
};

const createResponseValidationError = (response: Response, reason: 'html' | 'invalid_json') => {
  const contentType = normalizeMediaType(response.headers.get('content-type')) || 'unknown';
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
    const sanitizedPath = parsedUrl.pathname
      .split('/')
      .map((segment) => {
        if (!segment) return segment;
        if (isSecretShapedPathSegment(segment)) {
          return `h-${fingerprintToolsDebugString(segment)}`;
        }
        return removeControlCharacters(segment).slice(0, 80);
      })
      .join('/');

    return `${parsedUrl.origin}${sanitizedPath}`;
  } catch {
    return '[invalid MCP URL]';
  }
};

const getRequestMetadata = (input: FetchInput, init?: FetchInit) => {
  let url = '';
  let method = init?.method;
  try {
    if (input instanceof Request) {
      url = input.url;
      method ||= input.method;
    } else {
      url = input.toString();
    }
  } catch {
    url = '';
  }

  return {
    endpoint: url ? sanitizeMCPURLForLogging(url) : '[unavailable MCP URL]',
    method: method || 'GET',
  };
};

const getResponseMetadata = (response: Response) => ({
  contentEncoding: response.headers.get('content-encoding') || undefined,
  contentLength: (() => {
    const header = response.headers.get('content-length');
    if (!header) return undefined;
    const value = Number(header);
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  })(),
  httpStatus: response.status,
  mediaType: normalizeMediaType(response.headers.get('content-type')),
  redirected: response.redirected,
});

export const validateMCPHTTPResponse = async (response: Response): Promise<Response> => {
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  const mediaType = contentType.split(';', 1)[0].trim();
  const isJSONMediaType =
    mediaType === 'application/json' || /^application\/[\w!#$&+.^-]+\+json$/i.test(mediaType);
  if (contentType.includes('text/event-stream')) {
    return response.ok ? response : stripResponseBody(response);
  }

  let responseBody: string;
  try {
    responseBody = await response.clone().text();
  } catch (error) {
    logToolsDebugSafe('transport_response_rejected', {
      ...getResponseMetadata(response),
      ...describeToolsDebugError(error),
      bodyKind: 'unreadable',
      failurePhase: 'response_read',
    });
    throw createMCPError(
      'CONNECTION_FAILED',
      `MCP server response body could not be read (HTTP ${response.status}).`,
      { step: 'http_response_read' },
    );
  }
  if (contentType.includes('text/html') || isHTMLDocument(responseBody)) {
    logToolsDebugSafe('transport_response_rejected', {
      ...getResponseMetadata(response),
      bodyBytes: Buffer.byteLength(responseBody, 'utf8'),
      bodyKind: 'html',
      failurePhase: 'response_validation',
      htmlMarker: responseBody.trimStart().toLowerCase().startsWith('<!doctype html')
        ? 'doctype'
        : 'html_tag',
      responseFingerprint: fingerprintToolsDebugString(responseBody),
    });
    throw createResponseValidationError(response, 'html');
  }
  if (!response.ok) return stripResponseBody(response);
  if (EMPTY_RESPONSE_STATUSES.has(response.status)) return response;
  if (!isJSONMediaType) return response;

  try {
    JSON.parse(responseBody);
  } catch {
    logToolsDebugSafe('transport_response_rejected', {
      ...getResponseMetadata(response),
      bodyBytes: Buffer.byteLength(responseBody, 'utf8'),
      bodyKind: 'invalid_json',
      failurePhase: 'response_validation',
      responseFingerprint: fingerprintToolsDebugString(responseBody),
    });
    throw createResponseValidationError(response, 'invalid_json');
  }

  return response;
};

export const createMCPValidatingFetch = (fetchFn: typeof fetch = fetch): typeof fetch => {
  return (async (input: FetchInput, init?: FetchInit) => {
    const start = Date.now();
    const request = getRequestMetadata(input, init);
    logToolsDebugSafe('transport_request_started', { ...request, attempt: 1 });
    try {
      const response = await fetchFn(input, init);
      const validated = await validateMCPHTTPResponse(response);
      logToolsDebugSafe('transport_request_complete', {
        ...request,
        ...getResponseMetadata(response),
        attempt: 1,
        durationMs: Date.now() - start,
      });
      return validated;
    } catch (error) {
      logToolsDebugSafe('transport_request_failed', {
        ...request,
        ...describeToolsDebugError(error),
        attempt: 1,
        durationMs: Date.now() - start,
        failurePhase: 'fetch_or_validation',
      });
      throw error;
    }
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
    input: FetchInput,
    init: FetchInit,
    requestAccessToken: string | undefined,
  ): Promise<Response> => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));

    if (requestAccessToken) {
      headers.set('Authorization', `Bearer ${requestAccessToken}`);
    }

    return fetchFn(input, { ...init, headers });
  };

  return (async (input: FetchInput, init?: FetchInit) => {
    const start = Date.now();
    const request = getRequestMetadata(input, init);
    let attempt = 1;
    logToolsDebugSafe('transport_request_started', {
      ...request,
      attempt,
      credentialConfigured: !!accessToken || !!tokenGetter,
    });

    try {
      const requestAccessToken = await getInitialAccessToken();
      let response = await fetchWithAccessToken(input, init, requestAccessToken);

      if (response.status !== 401) {
        const validated = await validateMCPHTTPResponse(response);
        logToolsDebugSafe('transport_request_complete', {
          ...request,
          ...getResponseMetadata(response),
          attempt,
          durationMs: Date.now() - start,
        });
        return validated;
      }

      if (!tokenGetter) {
        const validated = await validateMCPHTTPResponse(response);
        logToolsDebugSafe('transport_request_complete', {
          ...request,
          ...getResponseMetadata(response),
          attempt,
          durationMs: Date.now() - start,
        });
        return validated;
      }

      attempt += 1;
      logToolsDebugSafe('transport_request_retry', {
        ...request,
        attempt,
        httpStatus: response.status,
        reason: 'oauth_unauthorized',
      });
      const replacementAccessToken =
        accessToken && accessToken !== requestAccessToken
          ? accessToken
          : await forceRefreshAccessToken();

      if (!replacementAccessToken) throw createAuthorizationError();

      response = await fetchWithAccessToken(input, init, replacementAccessToken);
      if (response.status === 401) throw createAuthorizationError();

      const validated = await validateMCPHTTPResponse(response);
      logToolsDebugSafe('transport_request_complete', {
        ...request,
        ...getResponseMetadata(response),
        attempt,
        durationMs: Date.now() - start,
      });
      return validated;
    } catch (error) {
      logToolsDebugSafe('transport_request_failed', {
        ...request,
        ...describeToolsDebugError(error),
        attempt,
        durationMs: Date.now() - start,
        failurePhase: 'fetch_or_validation',
      });
      throw error;
    }
  }) as typeof fetch;
};
