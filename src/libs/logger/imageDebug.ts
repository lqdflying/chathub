import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomUUID } from 'node:crypto';

import { CHATHUB_IMAGE_DIAGNOSTIC_ID_PATTERN } from '@/const/tools';

import { type ImageDebugLevel, parseImageDebugLevel } from './bootstrap';

const IMAGE_DEBUG_NAMESPACE = 'chathub-image-debug';
const IMAGE_DEBUG_MAX_ARRAY = 10;
const IMAGE_DEBUG_MAX_DEPTH = 6;
const IMAGE_DEBUG_MAX_PROPERTIES = 50;
const IMAGE_DEBUG_MAX_RECORD_BYTES = 16 * 1024;
const IMAGE_DEBUG_FINGERPRINT_STRING_SAMPLE_CODE_UNITS = 1024;
export const IMAGE_DEBUG_FINGERPRINT_BYTES = 256 * 1024;

const SECRET_KEY_PATTERN =
  /token|secret|password|api[_-]?key|authorization|cookie|credential|client[_-]?secret|access[_-]?token|refresh[_-]?token|pkce|verifier|headers?/i;
const PRIVATE_IDENTIFIER_KEY_PATTERN =
  /^(?:id|(?:user|account|session|connection|request|client|tenant|topic|task|generation|batch|database)[_-]?id)$/i;
const SENSITIVE_STRING_KEY_PATTERN =
  /prompt|url|uri|body|html|imagedata|imageurl|imageurls|message|stack|environment|env/i;
const SAFE_LABEL_KEY_PATTERN =
  /^(?:bodyKind|contentEncoding|debugLevel|deploymentMode|errorClass|errorCode|errorType|failurePhase|firstCharacterClass|htmlMarker|imageUrlKind|internalOriginSource|lastCharacterClass|mediaType|method|operation|outcome|phase|reason|runtime|schemaVersion|status|taskStatus|timestamp|transport|type|warning)$/;
const SAFE_IDENTIFIER_KEY_PATTERN = /(?:diagnosticId|spanId|Fingerprint|Hash|hash|Hashes|IdHash)$/;
const SAFE_ERROR_CODE_KEY_PATTERN = /^(?:code|errorCode)$/;
const SAFE_ERROR_CODE_VALUE_PATTERN = /^(?:[A-Z][\dA-Z_]{1,63}|\d{3})$/;
const SAFE_ERROR_CLASSES = new Set([
  'AbortError',
  'AggregateError',
  'DOMException',
  'EncodingError',
  'Error',
  'EvalError',
  'NetworkError',
  'OtherError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TimeoutError',
  'TypeError',
  'URIError',
]);
const CREDENTIAL_SHAPED_VALUE_PATTERN =
  /^bearer\s+|^basic\s+|^sk[_-]|^pk[_-]|eyj[\w-]{8,}\.|(?:token|secret|password|api[_-]?key|cookie|credential)\s*[:=]|[\w+/=-]{48,}/i;

export type ImageDebugEvent =
  | 'async_route_settled'
  | 'async_route_started'
  | 'async_task_started'
  | 'batch_persisted'
  | 'config_warning'
  | 'dispatch_settled'
  | 'dispatch_started'
  | 'provider_call_settled'
  | 'provider_call_started'
  | 'submission_accepted'
  | 'task_status_settled'
  | 'transform_settled'
  | 'upload_settled';

export interface ImageDebugContext {
  diagnosticId?: string;
  operation?: string;
  runtime?: string;
  transport?: string;
}

interface ImageDebugStore extends ImageDebugContext {
  sequence: { value: number };
  spanId: string;
  startedAt: number;
}

export interface ImageDebugErrorMetadata {
  aborted?: boolean;
  causeDepth: number;
  code?: number | string;
  errorClass: string;
  errorFingerprint?: string;
  messageLength?: number;
  timedOut?: boolean;
}

const imageDebugContext = new AsyncLocalStorage<ImageDebugStore>();

const byteLength = (value: string) => Buffer.byteLength(value, 'utf8');
const normalizeImageDebugErrorClass = (value: string) =>
  SAFE_ERROR_CLASSES.has(value) ? value : 'OtherError';

const replaceControlCharacters = (value: string) =>
  [...value]
    .map((character) => {
      const code = character.codePointAt(0) || 0;
      return code <= 31 || code === 127 ? ' ' : character;
    })
    .join('');

const getFingerprintKey = (): string | undefined =>
  process.env.KEY_VAULTS_SECRET || process.env.NEXT_AUTH_SECRET;

export const hasImageDebugFingerprintKey = (): boolean => !!getFingerprintKey();

const canonicalizeFingerprintString = (value: string): unknown => {
  const sampleSize = IMAGE_DEBUG_FINGERPRINT_STRING_SAMPLE_CODE_UNITS;
  if (value.length <= sampleSize * 3) return value;

  const middleStart = Math.max(0, Math.floor((value.length - sampleSize) / 2));
  return {
    head: value.slice(0, sampleSize),
    length: value.length,
    middle: value.slice(middleStart, middleStart + sampleSize),
    tail: value.slice(-sampleSize),
    type: 'sampled-string',
  };
};

const getBoundedFingerprintKey = (key: string) =>
  key.length <= IMAGE_DEBUG_FINGERPRINT_STRING_SAMPLE_CODE_UNITS
    ? key
    : `${key.slice(0, IMAGE_DEBUG_FINGERPRINT_STRING_SAMPLE_CODE_UNITS)}:${key.length}`;

const collectBoundedFingerprintKeys = (record: Record<string, unknown>) => {
  const keys: Array<{ boundedKey: string; originalKey: string }> = [];
  let propertiesTruncated = false;
  let inspectedProperties = 0;

  for (const originalKey in record) {
    if (!Object.hasOwn(record, originalKey)) continue;
    inspectedProperties += 1;
    if (inspectedProperties > IMAGE_DEBUG_MAX_PROPERTIES) {
      propertiesTruncated = true;
      break;
    }

    const boundedKey = getBoundedFingerprintKey(originalKey);
    if (SECRET_KEY_PATTERN.test(boundedKey)) continue;
    keys.push({ boundedKey, originalKey });
  }

  return {
    keys: keys.sort(({ boundedKey: firstKey }, { boundedKey: secondKey }) =>
      firstKey.localeCompare(secondKey),
    ),
    propertiesTruncated,
  };
};

const canonicalizeFingerprintValue = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return canonicalizeFingerprintString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return typeof value;
  if (depth >= IMAGE_DEBUG_MAX_DEPTH) return '[truncated:max-depth]';
  if (seen.has(value)) return '[circular]';

  seen.add(value);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, IMAGE_DEBUG_MAX_ARRAY)
      .map((item) => canonicalizeFingerprintValue(item, seen, depth + 1));
    if (value.length <= IMAGE_DEBUG_MAX_ARRAY) return items;

    return {
      itemCount: value.length,
      items,
      omittedItems: value.length - IMAGE_DEBUG_MAX_ARRAY,
      type: 'sampled-array',
    };
  }

  const record = value as Record<string, unknown>;
  const { keys, propertiesTruncated } = collectBoundedFingerprintKeys(record);
  const entries = keys.map(({ boundedKey, originalKey }) => [
    boundedKey,
    canonicalizeFingerprintValue(record[originalKey], seen, depth + 1),
  ]);
  if (!propertiesTruncated) return Object.fromEntries(entries);

  return {
    entries,
    propertiesTruncated: true,
    type: 'sampled-object',
  };
};

export const fingerprintImageDebugValue = (scope: string, value: unknown): string | undefined => {
  const key = getFingerprintKey();
  if (!key) return undefined;

  let serializedValue: string;
  try {
    serializedValue = JSON.stringify(canonicalizeFingerprintValue(value));
  } catch {
    serializedValue = Object.prototype.toString.call(value);
  }

  return createHmac('sha256', key)
    .update(`chathub:image-debug:${scope}\0`)
    .update(serializedValue, 'utf8')
    .digest('hex')
    .slice(0, 32);
};

export const fingerprintImageDebugBytes = (value: Uint8Array): string | undefined => {
  const key = getFingerprintKey();
  if (!key) return undefined;

  return createHmac('sha256', key)
    .update('chathub:image-debug:bytes\0')
    .update(value.subarray(0, IMAGE_DEBUG_FINGERPRINT_BYTES))
    .digest('hex')
    .slice(0, 16);
};

const fingerprintDebugString = (scope: string, value: string) => ({
  hash: fingerprintImageDebugValue(scope, value),
  length: value.length,
  type: 'string' as const,
});

const fingerprintDebugIdentifier = (value: unknown) => ({
  hash: fingerprintImageDebugValue('identifier', value),
  type: 'identifier' as const,
});

const sanitizeDebugLabel = (value: string): string | { hash?: string; length: number } => {
  const normalized = replaceControlCharacters(value.slice(0, 160)).trim();
  if (!normalized || CREDENTIAL_SHAPED_VALUE_PATTERN.test(normalized)) {
    return { hash: fingerprintImageDebugValue('label', value), length: value.length };
  }
  return normalized;
};

export const createImageDiagnosticId = () => `ig_${randomUUID().replaceAll('-', '').slice(0, 20)}`;

export const normalizeImageDiagnosticId = (value: string | null | undefined) =>
  value && CHATHUB_IMAGE_DIAGNOSTIC_ID_PATTERN.test(value) ? value : undefined;

export const getImageDebugContext = (): Readonly<ImageDebugContext> | undefined =>
  imageDebugContext.getStore();

export const bindImageDebugContext = <Arguments extends unknown[], Result>(
  callback: (...arguments_: Arguments) => Result,
): ((...arguments_: Arguments) => Result) => {
  const store = imageDebugContext.getStore();
  if (!store) return callback;

  return (...arguments_: Arguments) =>
    imageDebugContext.run(store, () => callback(...arguments_));
};

export const runWithImageDebugContext = <T>(context: ImageDebugContext, callback: () => T): T => {
  const parent = imageDebugContext.getStore();
  const requestedDiagnosticId = normalizeImageDiagnosticId(context.diagnosticId);
  const store: ImageDebugStore = {
    ...parent,
    ...context,
    diagnosticId: requestedDiagnosticId || parent?.diagnosticId || createImageDiagnosticId(),
    sequence: parent?.sequence || { value: 0 },
    spanId: parent?.spanId || `is_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    startedAt: parent?.startedAt || Date.now(),
  };

  return imageDebugContext.run(store, callback);
};

export const isImageDebugEnabled = (
  minimumLevel: Exclude<ImageDebugLevel, 'off'> = 'safe',
): boolean => {
  const level = parseImageDebugLevel(process.env.CHATHUB_IMAGE_DEBUG);
  return level === 'verbose' || (level === 'safe' && minimumLevel === 'safe');
};

export const describeImageDebugError = (error: unknown): ImageDebugErrorMetadata => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  let causeDepth = 0;
  let message = '';
  let code: number | string | undefined;
  let errorClass = 'OtherError';

  while (current && causeDepth < 5 && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      if (causeDepth === 0) {
        errorClass = normalizeImageDebugErrorClass(current.name || 'Error');
        message = current.message || '';
        const candidateCode = (current as Error & { code?: unknown }).code;
        if (typeof candidateCode === 'string' || typeof candidateCode === 'number') {
          code = candidateCode;
        }
      }
      current = current.cause;
    } else if (typeof current === 'object') {
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
    causeDepth += 1;
  }

  const normalizedMessage = message.toLowerCase();
  return {
    aborted: errorClass === 'AbortError',
    causeDepth,
    code,
    errorClass,
    errorFingerprint: message ? fingerprintImageDebugValue('error-message', message) : undefined,
    messageLength: message ? message.length : undefined,
    timedOut: normalizedMessage.includes('timeout') || normalizedMessage.includes('timed out'),
  };
};

const sanitizeSafeRecord = (value: unknown, key = '', depth = 0): unknown => {
  if (value === null || value === undefined) return value;
  if (SECRET_KEY_PATTERN.test(key)) return undefined;
  if (PRIVATE_IDENTIFIER_KEY_PATTERN.test(key)) return fingerprintDebugIdentifier(value);
  if (typeof value === 'string') {
    if (key === 'provider') return fingerprintDebugString('provider', value);
    if (key === 'errorClass') return normalizeImageDebugErrorClass(value);
    if (SAFE_ERROR_CODE_KEY_PATTERN.test(key) && !SAFE_ERROR_CODE_VALUE_PATTERN.test(value)) {
      return fingerprintDebugString(key || 'string', value);
    }
    if (SAFE_LABEL_KEY_PATTERN.test(key) || SAFE_IDENTIFIER_KEY_PATTERN.test(key)) {
      return sanitizeDebugLabel(value);
    }
    if (SENSITIVE_STRING_KEY_PATTERN.test(key)) return fingerprintDebugString(key, value);
    return fingerprintDebugString(key || 'string', value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return { type: typeof value };
  if (depth >= IMAGE_DEBUG_MAX_DEPTH) return '[truncated:max-depth]';
  if (Array.isArray(value)) {
    return value
      .slice(0, IMAGE_DEBUG_MAX_ARRAY)
      .map((item) => sanitizeSafeRecord(item, key, depth + 1));
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .slice(0, IMAGE_DEBUG_MAX_PROPERTIES)
    .flatMap(([childKey, childValue]) => {
      const sanitized = sanitizeSafeRecord(childValue, childKey, depth + 1);
      return sanitized === undefined ? [] : [[childKey, sanitized] as const];
    });
  return Object.fromEntries(entries);
};

const sanitizeVerbosePayload = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return fingerprintDebugString('verbose-payload', value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    return { type: typeof value };
  }
  if (typeof value !== 'object') return { type: typeof value };
  if (depth >= IMAGE_DEBUG_MAX_DEPTH) return '[truncated:max-depth]';
  if (Array.isArray(value)) {
    return {
      itemCount: value.length,
      items: value
        .slice(0, IMAGE_DEBUG_MAX_ARRAY)
        .map((item) => sanitizeVerbosePayload(item, depth + 1)),
      omittedItems: Math.max(0, value.length - IMAGE_DEBUG_MAX_ARRAY),
      type: 'array',
    };
  }

  const source = value as Record<string, unknown>;
  const { keys, propertiesTruncated } = collectBoundedFingerprintKeys(source);
  return {
    entries: keys.map(({ boundedKey, originalKey }) => ({
      key: fingerprintDebugString('verbose-key', boundedKey),
      value: sanitizeVerbosePayload(source[originalKey], depth + 1),
    })),
    propertiesTruncated,
    type: 'object',
  };
};

const isStructuredLevelEnabled = (
  configuredLevel: ImageDebugLevel,
  eventLevel: Exclude<ImageDebugLevel, 'off'>,
) => configuredLevel === 'verbose' || (configuredLevel === 'safe' && eventLevel === 'safe');

const buildStructuredRecord = (
  debugLevel: Exclude<ImageDebugLevel, 'off'>,
  fields: Record<string, unknown>,
) => {
  const context = imageDebugContext.getStore();
  const sequence = context ? ++context.sequence.value : undefined;
  const common = context
    ? {
        diagnosticId: context.diagnosticId,
        elapsedMs: Date.now() - context.startedAt,
        eventSequence: sequence,
        operation: context.operation,
        runtime: context.runtime,
        spanId: context.spanId,
        transport: context.transport,
      }
    : {};

  return sanitizeSafeRecord({
    debugLevel,
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    ...common,
    ...fields,
  }) as Record<string, unknown>;
};

const safelyBuildStructuredRecord = (
  debugLevel: Exclude<ImageDebugLevel, 'off'>,
  fields: Record<string, unknown>,
) => {
  try {
    return buildStructuredRecord(debugLevel, fields);
  } catch {
    return {
      debugLevel,
      recordSanitizationFailed: true,
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
    };
  }
};

const writeStructuredRecord = (event: ImageDebugEvent, record: Record<string, unknown>) => {
  const prefix = `[${IMAGE_DEBUG_NAMESPACE}:${event}]`;

  try {
    let json = JSON.stringify(record);
    const recordBytes = byteLength(json);
    if (recordBytes > IMAGE_DEBUG_MAX_RECORD_BYTES) {
      json = JSON.stringify({
        debugLevel: record.debugLevel,
        diagnosticId: record.diagnosticId,
        eventSequence: record.eventSequence,
        originalRecordBytes: recordBytes,
        recordTruncated: true,
        schemaVersion: 1,
        spanId: record.spanId,
        timestamp: record.timestamp,
      });
    }
    // eslint-disable-next-line no-console
    console.log(prefix, json);
  } catch {
    try {
      // eslint-disable-next-line no-console
      console.log(
        prefix,
        JSON.stringify({
          debugLevel: record.debugLevel,
          schemaVersion: 1,
          serializationError: true,
        }),
      );
    } catch {
      // Diagnostics must never interrupt image generation.
    }
  }
};

export const logImageDebugSafe = (event: ImageDebugEvent, fields: Record<string, unknown> = {}) => {
  const configuredLevel = parseImageDebugLevel(process.env.CHATHUB_IMAGE_DEBUG);
  if (!isStructuredLevelEnabled(configuredLevel, 'safe')) return;
  writeStructuredRecord(event, safelyBuildStructuredRecord('safe', fields));
};

export const logImageDebugVerbose = (event: ImageDebugEvent, payload: unknown) => {
  const configuredLevel = parseImageDebugLevel(process.env.CHATHUB_IMAGE_DEBUG);
  if (!isStructuredLevelEnabled(configuredLevel, 'verbose')) return;

  let sanitizedPayload: unknown;
  try {
    sanitizedPayload = sanitizeVerbosePayload(payload);
  } catch {
    sanitizedPayload = { type: 'unavailable' };
  }

  writeStructuredRecord(
    event,
    safelyBuildStructuredRecord('verbose', { payload: sanitizedPayload }),
  );
};
