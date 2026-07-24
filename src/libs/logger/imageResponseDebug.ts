import {
  IMAGE_DEBUG_FINGERPRINT_BYTES,
  fingerprintImageDebugBytes,
  isImageDebugEnabled,
} from './imageDebug';

export interface ImageDebugResponseBodySample {
  bytes: Uint8Array;
  truncated: boolean;
}

export const parseImageDebugContentLength = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const normalizeMediaType = (value: string | null) =>
  value?.split(';', 1)[0].trim().toLowerCase() || undefined;

const classifyBodyKind = (prefix: string, mediaType: string | undefined) => {
  if (!prefix) return 'empty';
  if (prefix.startsWith('<!doctype html')) return 'html';
  if (prefix.startsWith('<html')) return 'html';
  if (mediaType === 'text/html' || prefix.startsWith('<')) return 'html';
  if (mediaType?.includes('json')) return 'json';
  if (prefix.startsWith('{') || prefix.startsWith('[')) return 'json';
  return mediaType || 'unknown';
};

export const createImageDebugResponseBodySample = (
  bodyText: string,
): ImageDebugResponseBodySample => {
  const maximumEncodedBytes = Math.min(
    IMAGE_DEBUG_FINGERPRINT_BYTES,
    Math.max(1, bodyText.length * 3),
  );
  const sampleBuffer = new Uint8Array(maximumEncodedBytes);
  const { read, written } = new TextEncoder().encodeInto(bodyText, sampleBuffer);

  return {
    bytes: sampleBuffer.subarray(0, written),
    truncated: read < bodyText.length,
  };
};

export const summarizeImageDebugResponse = (
  response: Response,
  bodySample?: ImageDebugResponseBodySample,
) => {
  const mediaType = normalizeMediaType(response.headers.get('content-type'));
  const metadata: Record<string, unknown> = {
    contentEncoding: response.headers.get('content-encoding') || undefined,
    contentLength: parseImageDebugContentLength(response.headers.get('content-length')),
    httpStatus: response.status,
    mediaType,
  };

  if (!isImageDebugEnabled() || !bodySample) return metadata;

  const prefix = new TextDecoder()
    .decode(bodySample.bytes.subarray(0, 256))
    .trimStart()
    .toLowerCase();
  metadata.bodyKind = classifyBodyKind(prefix, mediaType);
  metadata.fingerprintBytes = bodySample.bytes.byteLength;
  metadata.fingerprintTruncated = bodySample.truncated;
  metadata.responseFingerprint = fingerprintImageDebugBytes(bodySample.bytes);

  return metadata;
};
