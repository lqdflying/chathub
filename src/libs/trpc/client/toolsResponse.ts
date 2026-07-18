import {
  CHATHUB_TOOLS_DIAGNOSTIC_HEADER,
  CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN,
} from '@/const/tools';

const FINGERPRINT_BYTES = 256 * 1024;
const SAFE_LABEL_MAX_LENGTH = 160;
const SENSITIVE_TECHNICAL_LABEL_PATTERN =
  /bearer\s|basic\s|token|secret|password|api[ _-]?key|cookie|credential|session=/i;
const CREDENTIAL_SHAPED_TECHNICAL_LABEL_PATTERN =
  /eyj|sk[_-]|pk[_-]|[\w+/=-]{32,}/i;
const SAFE_TECHNICAL_LABEL_PATTERN = /^[\w ()+,./:;-]+$/;

type FetchInit = Parameters<typeof fetch>[1];
type FetchInput = Parameters<typeof fetch>[0];
type HeadersInput = ConstructorParameters<typeof Headers>[0];

export type ToolsRPCResponseBodyKind =
  | 'empty'
  | 'html'
  | 'invalid_json'
  | 'network_error'
  | 'truncated_json'
  | 'unreadable'
  | 'unexpected_text';

export type ToolsRPCResponseFailureReason =
  | 'network_error'
  | 'response_parse_failed'
  | 'response_read_failed';

export interface ToolsRPCGatewayMetadata {
  cacheStatus?: string;
  requestIdHash?: string;
  server?: string;
  upstreamDurationMs?: number;
  via?: string;
}

export interface ToolsRPCResponseErrorDetails {
  bodyBytes?: number;
  bodyKind: ToolsRPCResponseBodyKind;
  contentEncoding?: string;
  contentLength?: number;
  diagnosticId?: string;
  durationMs: number;
  errorClass?: 'Error' | 'NetworkError' | 'OtherError' | 'TimeoutError' | 'TypeError';
  errorCode?: string;
  failurePhase: 'network' | 'response_parse' | 'response_read';
  fingerprintBytes?: number;
  fingerprintTruncated?: boolean;
  firstCharacterClass?: string;
  gateway?: ToolsRPCGatewayMetadata;
  htmlMarker?: 'doctype' | 'html_tag' | 'less_than_prefix';
  httpStatus?: number;
  lastCharacterClass?: string;
  mediaType?: string;
  networkOnline?: boolean;
  reason: ToolsRPCResponseFailureReason;
  responseFingerprint?: string;
  timedOut?: boolean;
}

const isAbortError = (error: unknown) =>
  error instanceof Error &&
  (error.name === 'AbortError' || error.message === 'AbortError' || error.message.includes('user aborted'));

const describeNetworkError = (error: unknown) => {
  const name = error instanceof Error ? error.name : '';
  const errorClass = new Set(['Error', 'NetworkError', 'TimeoutError', 'TypeError']).has(name)
    ? (name as 'Error' | 'NetworkError' | 'TimeoutError' | 'TypeError')
    : 'OtherError';
  const candidateCode =
    error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const errorCode =
    typeof candidateCode === 'string' && /^[A-Z][\dA-Z_]{1,40}$/.test(candidateCode)
      ? candidateCode
      : undefined;
  const networkOnline =
    typeof globalThis.navigator?.onLine === 'boolean' ? globalThis.navigator.onLine : undefined;

  return {
    errorClass,
    errorCode,
    networkOnline,
    timedOut: name === 'TimeoutError' || errorCode === 'ETIMEDOUT',
  };
};

const normalizeDiagnosticId = (value: string | null | undefined) =>
  value && CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN.test(value) ? value : undefined;

const readDiagnosticId = (headers: HeadersInput | undefined) => {
  try {
    return normalizeDiagnosticId(new Headers(headers).get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER));
  } catch {
    return undefined;
  }
};

const normalizeMediaType = (value: string | null) => {
  const mediaType = value?.split(';', 1)[0].trim().toLowerCase();
  return mediaType &&
    mediaType.length <= 120 &&
    /^[\w!#$%&'*+.^`|~-]+\/[\w!#$%&'*+.^`|~-]+$/.test(mediaType)
    ? mediaType
    : undefined;
};

const safeHeaderLabel = (value: string | null, maximumLength = SAFE_LABEL_MAX_LENGTH) => {
  if (!value) return undefined;
  const sanitized = [...value]
    .map((character) => {
      const code = character.codePointAt(0) || 0;
      return code <= 31 || code === 127 ? ' ' : character;
    })
    .join('')
    .trim();
  if (
    !sanitized ||
    sanitized.length > maximumLength ||
    !SAFE_TECHNICAL_LABEL_PATTERN.test(sanitized) ||
    SENSITIVE_TECHNICAL_LABEL_PATTERN.test(sanitized) ||
    CREDENTIAL_SHAPED_TECHNICAL_LABEL_PATTERN.test(sanitized)
  ) {
    return undefined;
  }
  return sanitized;
};

const parsePositiveInteger = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const toHex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);

const fingerprintBytes = async (value: Uint8Array) => {
  try {
    if (!globalThis.crypto?.subtle) return undefined;
    const sample = value.slice(0, FINGERPRINT_BYTES);
    return toHex(await globalThis.crypto.subtle.digest('SHA-256', sample));
  } catch {
    return undefined;
  }
};

const fingerprintHeader = async (value: string | null) => {
  if (!value) return undefined;
  return fingerprintBytes(new TextEncoder().encode(value));
};

const classifyCharacter = (value: string | undefined) => {
  if (!value) return undefined;
  if (/\s/.test(value)) return 'whitespace';
  if (value === '<') return 'less_than';
  if (value === '{') return 'object_open';
  if (value === '}') return 'object_close';
  if (value === '[') return 'array_open';
  if (value === ']') return 'array_close';
  if (value === '"') return 'quote';
  if (/[\d-]/.test(value)) return 'number';
  if (/[a-z]/i.test(value)) return 'letter';
  return 'other';
};

const classifyInvalidBody = (
  text: string,
  mediaType: string | undefined,
): Pick<
  ToolsRPCResponseErrorDetails,
  'bodyKind' | 'firstCharacterClass' | 'htmlMarker' | 'lastCharacterClass'
> => {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const firstCharacterClass = classifyCharacter(trimmed[0]);
  const lastCharacterClass = classifyCharacter(trimmed.at(-1));

  if (!trimmed) return { bodyKind: 'empty', firstCharacterClass, lastCharacterClass };
  if (lower.startsWith('<!doctype html')) {
    return { bodyKind: 'html', firstCharacterClass, htmlMarker: 'doctype', lastCharacterClass };
  }
  if (lower.startsWith('<html')) {
    return { bodyKind: 'html', firstCharacterClass, htmlMarker: 'html_tag', lastCharacterClass };
  }
  if (mediaType === 'text/html' || lower.startsWith('<')) {
    return {
      bodyKind: 'html',
      firstCharacterClass,
      htmlMarker: 'less_than_prefix',
      lastCharacterClass,
    };
  }
  if (
    (trimmed.startsWith('{') && !trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && !trimmed.endsWith(']'))
  ) {
    return { bodyKind: 'truncated_json', firstCharacterClass, lastCharacterClass };
  }
  if (mediaType?.includes('json')) {
    return { bodyKind: 'invalid_json', firstCharacterClass, lastCharacterClass };
  }
  return { bodyKind: 'unexpected_text', firstCharacterClass, lastCharacterClass };
};

const collectGatewayMetadata = async (headers: Headers): Promise<ToolsRPCGatewayMetadata | undefined> => {
  const upstreamDurationMs = parsePositiveInteger(headers.get('x-envoy-upstream-service-time'));
  const gateway: ToolsRPCGatewayMetadata = {
    cacheStatus: safeHeaderLabel(headers.get('x-cache')),
    requestIdHash: await fingerprintHeader(
      headers.get('x-request-id') ||
        headers.get('cf-ray') ||
        headers.get('x-vercel-id') ||
        headers.get('traceparent'),
    ),
    server: safeHeaderLabel(headers.get('server')),
    upstreamDurationMs,
    via: safeHeaderLabel(headers.get('via')),
  };

  return Object.values(gateway).some((value) => value !== undefined) ? gateway : undefined;
};

export class ToolsRPCResponseError extends Error {
  readonly code = 'CHATHUB_TOOLS_RPC_RESPONSE_ERROR';
  readonly details: ToolsRPCResponseErrorDetails;

  constructor(details: ToolsRPCResponseErrorDetails) {
    super('The tools gateway returned an unusable response.');
    this.name = 'ToolsRPCResponseError';
    this.details = details;
  }
}

export const findToolsRPCResponseError = (error: unknown): ToolsRPCResponseError | undefined => {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; current && depth < 6 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof ToolsRPCResponseError) return current;
    if (
      typeof current === 'object' &&
      'code' in current &&
      (current as { code?: unknown }).code === 'CHATHUB_TOOLS_RPC_RESPONSE_ERROR' &&
      'details' in current
    ) {
      return current as ToolsRPCResponseError;
    }
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }

  return undefined;
};

export const createGuardedToolsFetch = (fetchFn: typeof fetch): typeof fetch =>
  (async (input: FetchInput, init?: FetchInit) => {
    const startedAt = Date.now();
    const diagnosticId = readDiagnosticId(init?.headers);
    let response: Response;

    try {
      response = await fetchFn(input, init);
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ToolsRPCResponseError({
        bodyKind: 'network_error',
        diagnosticId,
        durationMs: Date.now() - startedAt,
        ...describeNetworkError(error),
        failurePhase: 'network',
        reason: 'network_error',
      });
    }

    return new Proxy(response, {
      get(target, property) {
        if (property === 'json') {
          return async () => {
            let bytes: Uint8Array;
            try {
              bytes = new Uint8Array(await target.arrayBuffer());
            } catch (error) {
              if (isAbortError(error)) throw error;
              throw new ToolsRPCResponseError({
                bodyKind: 'unreadable',
                contentEncoding: safeHeaderLabel(target.headers.get('content-encoding'), 80),
                contentLength: parsePositiveInteger(target.headers.get('content-length')),
                diagnosticId:
                  diagnosticId ||
                  normalizeDiagnosticId(target.headers.get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER)),
                durationMs: Date.now() - startedAt,
                ...describeNetworkError(error),
                failurePhase: 'response_read',
                gateway: await collectGatewayMetadata(target.headers),
                httpStatus: target.status,
                mediaType: normalizeMediaType(target.headers.get('content-type')),
                reason: 'response_read_failed',
              });
            }
            const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '');

            try {
              return JSON.parse(text);
            } catch {
              const mediaType = normalizeMediaType(target.headers.get('content-type'));
              const bodyClassification = classifyInvalidBody(text, mediaType);
              const fingerprintSampleBytes = Math.min(bytes.byteLength, FINGERPRINT_BYTES);
              throw new ToolsRPCResponseError({
                bodyBytes: bytes.byteLength,
                ...bodyClassification,
                contentEncoding: safeHeaderLabel(target.headers.get('content-encoding'), 80),
                contentLength: parsePositiveInteger(target.headers.get('content-length')),
                diagnosticId:
                  diagnosticId ||
                  normalizeDiagnosticId(target.headers.get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER)),
                durationMs: Date.now() - startedAt,
                failurePhase: 'response_parse',
                fingerprintBytes: fingerprintSampleBytes,
                fingerprintTruncated: bytes.byteLength > FINGERPRINT_BYTES,
                gateway: await collectGatewayMetadata(target.headers),
                httpStatus: target.status,
                mediaType,
                reason: 'response_parse_failed',
                responseFingerprint: await fingerprintBytes(bytes),
              });
            }
          };
        }

        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }) as typeof fetch;
