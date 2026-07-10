import { HTTP_METHODS } from './constants';
import { type ApiTesterRequestDraft, createEmptyDraft, createHeaderRow } from './types';

export interface ApiTesterHistoryEntry {
  createdAt: number;
  id: string;
  request: ApiTesterRequestDraft;
  response?: {
    size: number;
    status: number;
    time: number;
  };
}

export const HISTORY_LIMIT = 50;

export const HISTORY_STORAGE_KEY = 'apitest-history';

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
]);

const SENSITIVE_HEADER_PATTERN =
  /(^|[-_])(api[-_]?key|auth|authorization|cookie|password|secret|token)([-_]|$)/;
const HTTP_METHOD_SET = new Set(HTTP_METHODS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

const redactQueryParam = (url: string, key: string): string => {
  if (!key.trim()) return url;

  const hashIndex = url.indexOf('#');
  const beforeFragment = hashIndex < 0 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex < 0 ? '' : url.slice(hashIndex);
  const queryIndex = beforeFragment.indexOf('?');
  if (queryIndex < 0) return url;

  const base = beforeFragment.slice(0, queryIndex);
  const query = beforeFragment
    .slice(queryIndex + 1)
    .split('&')
    .map((pair) => {
      const eqIndex = pair.indexOf('=');
      const rawKey = eqIndex < 0 ? pair : pair.slice(0, eqIndex);
      try {
        return decodeURIComponent(rawKey.replaceAll('+', ' ')) === key ? `${rawKey}=` : pair;
      } catch {
        return rawKey === key ? `${rawKey}=` : pair;
      }
    })
    .join('&');

  return `${base}?${query}${fragment}`;
};

const isSensitiveHeader = (key: string): boolean => {
  const normalized = key.trim().toLowerCase();
  return SENSITIVE_HEADER_NAMES.has(normalized) || SENSITIVE_HEADER_PATTERN.test(normalized);
};

export const normalizeHistoryRequest = (request: unknown): ApiTesterRequestDraft | null => {
  if (!isRecord(request)) return null;

  const base = createEmptyDraft();
  const method = typeof request.method === 'string' ? request.method.toUpperCase() : base.method;
  const url = typeof request.url === 'string' ? request.url : '';
  if (!HTTP_METHOD_SET.has(method) || !url) return null;

  const headers = Array.isArray(request.headers)
    ? request.headers
        .filter(isRecord)
        .filter((header) => typeof header.key === 'string' && typeof header.value === 'string')
        .map((header) => ({
          ...createHeaderRow(header.key, header.value),
          enabled: typeof header.enabled === 'boolean' ? header.enabled : true,
        }))
    : [];

  return {
    ...base,
    apiKeyLocation: request.apiKeyLocation === 'query' ? 'query' : 'header',
    apiKeyName: typeof request.apiKeyName === 'string' ? request.apiKeyName : base.apiKeyName,
    apiKeyValue: typeof request.apiKeyValue === 'string' ? request.apiKeyValue : '',
    authType:
      request.authType === 'apikey' ||
      request.authType === 'basic' ||
      request.authType === 'bearer' ||
      request.authType === 'none'
        ? request.authType
        : 'none',
    basicPassword: typeof request.basicPassword === 'string' ? request.basicPassword : '',
    basicUsername: typeof request.basicUsername === 'string' ? request.basicUsername : '',
    bearerToken: typeof request.bearerToken === 'string' ? request.bearerToken : '',
    body: typeof request.body === 'string' ? request.body : '',
    contentType: typeof request.contentType === 'string' ? request.contentType : base.contentType,
    headers: headers.length > 0 ? headers : [createHeaderRow()],
    method,
    url,
  };
};

export const sanitizeHistoryEntry = (entry: ApiTesterHistoryEntry): ApiTesterHistoryEntry => {
  const request = normalizeHistoryRequest(entry.request) ?? createEmptyDraft();
  const nextRequest: ApiTesterRequestDraft = {
    ...request,
    apiKeyValue: '',
    basicPassword: '',
    bearerToken: '',
    headers: request.headers.map((header) => ({
      ...header,
      value: isSensitiveHeader(header.key) ? '' : header.value,
    })),
  };

  if (request.authType === 'apikey') {
    nextRequest.url = redactQueryParam(request.url, request.apiKeyName);
  }

  return { ...entry, request: nextRequest };
};

/**
 * Prepends an entry and caps the list at `limit` items. Pure.
 */
export const appendHistoryEntry = (
  entries: ApiTesterHistoryEntry[],
  entry: ApiTesterHistoryEntry,
  limit: number = HISTORY_LIMIT,
): ApiTesterHistoryEntry[] => {
  return [sanitizeHistoryEntry(entry), ...entries.map(sanitizeHistoryEntry)].slice(0, limit);
};

const normalizeHistoryEntry = (entry: unknown): ApiTesterHistoryEntry | null => {
  if (!entry || typeof entry !== 'object') return null;
  const candidate = entry as Partial<ApiTesterHistoryEntry>;
  const request = normalizeHistoryRequest(candidate.request);
  if (!request || typeof candidate.id !== 'string' || typeof candidate.createdAt !== 'number') {
    return null;
  }

  const response = isRecord(candidate.response)
    ? {
        size: typeof candidate.response.size === 'number' ? candidate.response.size : 0,
        status: typeof candidate.response.status === 'number' ? candidate.response.status : 0,
        time: typeof candidate.response.time === 'number' ? candidate.response.time : 0,
      }
    : undefined;

  return {
    createdAt: candidate.createdAt,
    id: candidate.id,
    request,
    response,
  };
};

/**
 * Loads history from localStorage. Returns [] on any failure (missing key,
 * corrupt JSON, unexpected shape).
 */
export const loadHistory = (): ApiTesterHistoryEntry[] => {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeHistoryEntry(entry))
      .filter((entry): entry is ApiTesterHistoryEntry => !!entry)
      .map(sanitizeHistoryEntry)
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
};

/**
 * Persists redacted history to localStorage. Request secrets are intentionally
 * cleared before storage because web storage is readable by origin scripts.
 */
export const saveHistory = (entries: ApiTesterHistoryEntry[]): void => {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries.map(sanitizeHistoryEntry)));
  } catch {
    // storage full or unavailable — history is best-effort
  }
};
