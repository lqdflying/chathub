interface UriParserResult {
  base64: string | null;
  mimeType: string | null;
  type: 'url' | 'base64' | null;
}

const BASE64_MARKER = ';base64,';
const DATA_URI_PREFIX = 'data:';

const containsLineTerminator = (value: string, startIndex: number): boolean =>
  value.includes('\n', startIndex) ||
  value.includes('\r', startIndex) ||
  value.includes('\u2028', startIndex) ||
  value.includes('\u2029', startIndex);

export const parseDataUri = (dataUri: string): UriParserResult => {
  if (dataUri.startsWith(DATA_URI_PREFIX)) {
    const markerIndex = dataUri.indexOf(';', DATA_URI_PREFIX.length);
    const payloadStartIndex = markerIndex + BASE64_MARKER.length;
    const hasValidMarker =
      markerIndex > DATA_URI_PREFIX.length && dataUri.startsWith(BASE64_MARKER, markerIndex);
    const hasPayload = hasValidMarker && payloadStartIndex < dataUri.length;

    if (hasPayload && !containsLineTerminator(dataUri, payloadStartIndex)) {
      return {
        base64: dataUri.slice(payloadStartIndex),
        mimeType: dataUri.slice(DATA_URI_PREFIX.length, markerIndex),
        type: 'base64',
      };
    }
  }

  try {
    new URL(dataUri);
    return { base64: null, mimeType: null, type: 'url' };
  } catch {
    return { base64: null, mimeType: null, type: null };
  }
};
