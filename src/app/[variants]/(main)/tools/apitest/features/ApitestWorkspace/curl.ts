import { HTTP_METHODS } from './constants';
import { buildProxyRequestPayload } from './helpers';
import { type ApiTesterRequestDraft, createEmptyDraft, createHeaderRow } from './types';

export interface ParsedCurlRequest {
  basicPassword?: string;
  basicUsername?: string;
  bearerToken?: string;
  body?: string;
  contentType?: string;
  headers: { key: string; value: string }[];
  method: string;
  url: string;
}

/**
 * Splits a shell command into tokens, honoring single quotes, double quotes,
 * backslash escapes, and backslash-newline continuations.
 */
const tokenize = (command: string): string[] => {
  const input = command.replaceAll(/\\\r?\n/g, ' ');
  const tokens: string[] = [];

  let current = '';
  let hasToken = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === '\\' && i + 1 < input.length && '"\\$`'.includes(input[i + 1])) {
        current += input[++i];
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      hasToken = true;
    } else if (char === '\\' && i + 1 < input.length) {
      current += input[++i];
      hasToken = true;
    } else if (/\s/.test(char)) {
      if (hasToken || current) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
    } else {
      current += char;
      hasToken = true;
    }
  }

  if (hasToken || current) tokens.push(current);
  return tokens;
};

/** Flags whose argument we consume but ignore. */
const IGNORED_FLAGS_WITH_ARG = new Set([
  '--cacert',
  '--connect-timeout',
  '--max-time',
  '--output',
  '--retry',
  '-m',
  '-o',
  '-w',
  '--write-out',
]);

/** Boolean flags we silently skip. */
const IGNORED_FLAGS = new Set([
  '--compressed',
  '--fail',
  '--globoff',
  '--include',
  '--insecure',
  '--location',
  '--silent',
  '--verbose',
  '-#',
  '-f',
  '-g',
  '-i',
  '-k',
  '-L',
  '-s',
  '-S',
  '-v',
]);

const DATA_FLAGS = new Set(['--data', '--data-ascii', '--data-binary', '--data-raw', '-d']);

const SUPPORTED_METHODS = new Set(HTTP_METHODS);

const hasHeader = (headers: { key: string; value: string }[], key: string): boolean => {
  const normalized = key.toLowerCase();
  return headers.some((header) => header.key.toLowerCase() === normalized);
};

const appendQueryData = (url: string, data: string): string => {
  if (!data) return url;

  const hashIndex = url.indexOf('#');
  const beforeFragment = hashIndex < 0 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex < 0 ? '' : url.slice(hashIndex);
  const separator = beforeFragment.includes('?')
    ? beforeFragment.endsWith('?') || beforeFragment.endsWith('&')
      ? ''
      : '&'
    : '?';

  return `${beforeFragment}${separator}${data}${fragment}`;
};

/**
 * Parses a `curl ...` command line into a request description.
 * Returns null when the input is not a recognizable curl command.
 */
export const parseCurl = (command: string): ParsedCurlRequest | null => {
  const tokens = tokenize(command.trim());
  if (tokens.length === 0 || tokens[0].toLowerCase() !== 'curl') return null;

  let method = '';
  let url = '';
  let bearerToken: string | undefined;
  let basicUsername: string | undefined;
  let basicPassword: string | undefined;
  let contentType: string | undefined;
  let useDataAsQuery = false;
  let jsonBody = false;
  const jsonParts: string[] = [];
  const headers: { key: string; value: string }[] = [];
  const dataParts: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    const next = () => tokens[++i] ?? '';

    if (token === '-X' || token === '--request' || token.startsWith('-X')) {
      const raw = token === '-X' || token === '--request' ? next() : token.slice(2);
      const nextMethod = raw.toUpperCase();
      if (!SUPPORTED_METHODS.has(nextMethod)) return null;
      method = nextMethod;
    } else if (token === '-H' || token === '--header' || token.startsWith('-H')) {
      const raw = token === '-H' || token === '--header' ? next() : token.slice(2);
      const colonIndex = raw.indexOf(':');
      if (colonIndex < 0) continue;
      const key = raw.slice(0, colonIndex).trim();
      const value = raw.slice(colonIndex + 1).trim();
      if (!key) continue;
      if (key.toLowerCase() === 'content-type') {
        contentType = value;
      } else if (
        key.toLowerCase() === 'authorization' &&
        value.toLowerCase().startsWith('bearer ')
      ) {
        bearerToken = value.slice(7).trim();
      } else {
        headers.push({ key, value });
      }
    } else if (DATA_FLAGS.has(token) || token.startsWith('-d')) {
      dataParts.push(DATA_FLAGS.has(token) ? next() : token.slice(2));
    } else
      switch (token) {
        case '-G':
        case '--get': {
          useDataAsQuery = true;

          break;
        }
        case '--json': {
          jsonBody = true;
          jsonParts.push(next());
          contentType = 'application/json';

          break;
        }
        case '--data-urlencode': {
          const raw = next();
          const eqIndex = raw.indexOf('=');
          dataParts.push(
            eqIndex < 0
              ? encodeURIComponent(raw)
              : `${raw.slice(0, eqIndex)}=${encodeURIComponent(raw.slice(eqIndex + 1))}`,
          );

          break;
        }
        case '-u':
        case '--user': {
          const raw = token === '-u' || token === '--user' ? next() : token.slice(2);
          const colonIndex = raw.indexOf(':');
          basicUsername = colonIndex < 0 ? raw : raw.slice(0, colonIndex);
          basicPassword = colonIndex < 0 ? '' : raw.slice(colonIndex + 1);

          break;
        }
        case '--url': {
          url = next();

          break;
        }
        case '-I':
        case '--head': {
          method = method || 'HEAD';

          break;
        }
        case '-A':
        case '--user-agent': {
          headers.push({ key: 'User-Agent', value: next() });

          break;
        }
        case '-b':
        case '--cookie': {
          headers.push({ key: 'Cookie', value: next() });

          break;
        }
        case '-e':
        case '--referer': {
          headers.push({ key: 'Referer', value: next() });

          break;
        }
        default: {
          if (IGNORED_FLAGS_WITH_ARG.has(token)) {
            next();
          } else if (token.startsWith('-u') && token.length > 2) {
            const raw = token.slice(2);
            const colonIndex = raw.indexOf(':');
            basicUsername = colonIndex < 0 ? raw : raw.slice(0, colonIndex);
            basicPassword = colonIndex < 0 ? '' : raw.slice(colonIndex + 1);
          } else if (token.startsWith('-A') && token.length > 2) {
            headers.push({ key: 'User-Agent', value: token.slice(2) });
          } else if (token.startsWith('-b') && token.length > 2) {
            headers.push({ key: 'Cookie', value: token.slice(2) });
          } else if (token.startsWith('-e') && token.length > 2) {
            headers.push({ key: 'Referer', value: token.slice(2) });
          } else if (token.startsWith('-m') && token.length > 2) {
            // consumed ignored option value attached to short flag
          } else if (token.startsWith('-o') && token.length > 2) {
            // consumed ignored option value attached to short flag
          } else if (token.startsWith('-w') && token.length > 2) {
            // consumed ignored option value attached to short flag
          } else if (token.startsWith('-') && !token.startsWith('--')) {
            const flags = token.slice(1);
            const unsupportedValueFlag = [...flags].some((flag) =>
              ['A', 'b', 'd', 'e', 'H', 'm', 'o', 'u', 'w', 'X'].includes(flag),
            );
            if (unsupportedValueFlag) return null;
          } else if (IGNORED_FLAGS.has(token) || token.startsWith('-')) {
            // unknown flag — skip it (best effort)
          } else if (!url) {
            url = token;
          }
        }
      }
  }

  if (!url) return null;

  const joinedData = jsonBody
    ? [...dataParts, jsonParts.join('')].filter(Boolean).join('&')
    : dataParts.length > 0
      ? dataParts.join('&')
      : undefined;
  const body = joinedData && !useDataAsQuery ? joinedData : undefined;
  if (joinedData && useDataAsQuery) {
    url = appendQueryData(url, joinedData);
  }
  if (jsonBody && !hasHeader(headers, 'Accept')) {
    headers.push({ key: 'Accept', value: 'application/json' });
  }

  return {
    basicPassword,
    basicUsername,
    bearerToken,
    body,
    contentType,
    headers,
    method: method || (useDataAsQuery ? 'GET' : body ? 'POST' : 'GET'),
    url,
  };
};

/**
 * Converts a parsed curl command into a full request draft for the builder.
 */
export const parsedCurlToDraft = (parsed: ParsedCurlRequest): ApiTesterRequestDraft => {
  const draft = createEmptyDraft();

  draft.method = parsed.method;
  draft.url = parsed.url;
  draft.headers =
    parsed.headers.length > 0
      ? parsed.headers.map((h) => createHeaderRow(h.key, h.value))
      : [createHeaderRow()];
  if (parsed.body !== undefined) draft.body = parsed.body;
  if (parsed.contentType) draft.contentType = parsed.contentType;

  if (parsed.bearerToken) {
    draft.authType = 'bearer';
    draft.bearerToken = parsed.bearerToken;
  } else if (parsed.basicUsername !== undefined) {
    draft.authType = 'basic';
    draft.basicUsername = parsed.basicUsername;
    draft.basicPassword = parsed.basicPassword ?? '';
  }

  return draft;
};

const shellQuote = (text: string): string => `'${text.replaceAll("'", String.raw`'\''`)}'`;

/**
 * Renders the current request draft as a multi-line curl command.
 */
export const buildCurl = (draft: ApiTesterRequestDraft): string => {
  const payload = buildProxyRequestPayload(draft);
  const lines: string[] = [`curl -X ${payload.method} ${shellQuote(payload.url)}`];
  const isJsonBody =
    payload.body !== undefined &&
    (payload.headers?.['Content-Type'] || payload.headers?.['content-type']) === 'application/json';

  for (const [key, value] of Object.entries(payload.headers ?? {})) {
    if (isJsonBody && key.toLowerCase() === 'content-type') continue;
    lines.push(`-H ${shellQuote(`${key}: ${value}`)}`);
  }

  if (payload.body !== undefined) {
    lines.push(`${isJsonBody ? '--json' : '--data'} ${shellQuote(payload.body)}`);
  }

  return lines.join(' \\\n  ');
};
