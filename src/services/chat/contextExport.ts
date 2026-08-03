import type { ContextExportJsonValue } from '@lobechat/types';

const REDACTED_KEYS = new Set([
  'catalogModel',
  'debugToolCache',
  'metadata',
  'openAICompatCache',
  'openAICompatResponsesParams',
  'prompt_cache_key',
  'promptCacheKey',
  'provider',
  'responseStateMode',
  'safety_identifier',
  'safetyIdentifier',
  'user',
  'user_id',
  'userId',
]);

const JSON_SCHEMA_NAME_MAP_KEYS = new Set([
  '$defs',
  'definitions',
  'dependencies',
  'dependentRequired',
  'dependentSchemas',
  'patternProperties',
  'properties',
]);

const INLINE_MEDIA_CONTAINER_KEYS = new Set([
  'inlineData',
  'inline_data',
  'inputAudio',
  'input_audio',
  'source',
]);

const sanitizeString = (value: string): string => {
  if (/^data:/i.test(value)) {
    const mediaType = value.match(/^data:([^,;]*)(?:;[^,]*)?,/i)?.[1];
    return `[redacted data URL${mediaType ? `: ${mediaType}` : ''}]`;
  }

  return value;
};

const sanitizeValue = (
  value: unknown,
  preserveObjectKeys = false,
  redactMediaDataField = false,
): ContextExportJsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return redactMediaDataField ? '[redacted inline media data]' : sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, preserveObjectKeys, redactMediaDataField));
  }

  if (typeof value === 'object') {
    const sanitizedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => (preserveObjectKeys || !REDACTED_KEYS.has(key)) && item !== undefined)
      .map(([key, item]) => {
        const shouldRedactMediaData =
          redactMediaDataField && key === 'data' && typeof item === 'string';
        const shouldRedactNestedMediaData = INLINE_MEDIA_CONTAINER_KEYS.has(key);

        return [
          key,
          sanitizeValue(
            item,
            JSON_SCHEMA_NAME_MAP_KEYS.has(key),
            shouldRedactMediaData || shouldRedactNestedMediaData,
          ),
        ];
      });

    return Object.fromEntries(sanitizedEntries);
  }

  return String(value);
};

export const sanitizeContextExportValue = (value: unknown): ContextExportJsonValue =>
  sanitizeValue(value);

export const contextExportRedactions = [
  'credentials',
  'transportHeaders',
  'transportOptions',
  'baseUrls',
  'signalsAndCallbacks',
  'storedIdentifiers',
  'traceAndDiagnostics',
  'cacheRouting',
  'inlineMediaData',
];

