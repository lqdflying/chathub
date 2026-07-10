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
  const headers: { key: string; value: string }[] = [];
  const dataParts: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    const next = () => tokens[++i] ?? '';

    if (token === '-X' || token === '--request') {
      method = next().toUpperCase();
    } else if (token === '-H' || token === '--header') {
      const raw = next();
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
    } else if (DATA_FLAGS.has(token)) {
      dataParts.push(next());
    } else
      switch (token) {
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
          const raw = next();
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
          } else if (IGNORED_FLAGS.has(token) || token.startsWith('-')) {
            // unknown flag — skip it (best effort)
          } else if (!url) {
            url = token;
          }
        }
      }
  }

  if (!url) return null;

  const body = dataParts.length > 0 ? dataParts.join('&') : undefined;

  return {
    basicPassword,
    basicUsername,
    bearerToken,
    body,
    contentType,
    headers,
    method: method || (body ? 'POST' : 'GET'),
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

  for (const [key, value] of Object.entries(payload.headers ?? {})) {
    lines.push(`-H ${shellQuote(`${key}: ${value}`)}`);
  }

  if (payload.body !== undefined) {
    lines.push(`--data ${shellQuote(payload.body)}`);
  }

  return lines.join(' \\\n  ');
};
