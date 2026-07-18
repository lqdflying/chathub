import {
  TOOL_DEBUG_FINGERPRINT_BYTES,
  fingerprintToolsDebugBytes,
  isToolsDebugEnabled,
} from './toolsDebug';

export const parseToolsDebugContentLength = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const normalizeMediaType = (value: string | null) =>
  value?.split(';', 1)[0].trim().toLowerCase() || undefined;

export const summarizeToolsDebugResponse = async (response: Response) => {
  const mediaType = normalizeMediaType(response.headers.get('content-type'));
  const metadata: Record<string, unknown> = {
    contentEncoding: response.headers.get('content-encoding') || undefined,
    contentLength: parseToolsDebugContentLength(response.headers.get('content-length')),
    httpStatus: response.status,
    mediaType,
  };

  if (!isToolsDebugEnabled() || !response.body) return metadata;

  try {
    const reader = response.clone().body?.getReader();
    if (!reader) return metadata;
    const chunks: Uint8Array[] = [];
    let sampledBytes = 0;
    let truncated = false;

    while (sampledBytes < TOOL_DEBUG_FINGERPRINT_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = TOOL_DEBUG_FINGERPRINT_BYTES - sampledBytes;
      chunks.push(value.subarray(0, remaining));
      sampledBytes += Math.min(value.byteLength, remaining);
      if (value.byteLength > remaining) {
        truncated = true;
        break;
      }
    }
    if (sampledBytes === TOOL_DEBUG_FINGERPRINT_BYTES) truncated = true;
    await reader.cancel().catch(() => undefined);

    const sample = new Uint8Array(sampledBytes);
    let offset = 0;
    for (const chunk of chunks) {
      sample.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const prefix = new TextDecoder().decode(sample.subarray(0, 256)).trimStart().toLowerCase();
    metadata.bodyKind =
      prefix.startsWith('<!doctype html') || prefix.startsWith('<html')
        ? 'html'
        : mediaType?.includes('json')
          ? 'json'
          : mediaType || 'unknown';
    metadata.fingerprintBytes = sampledBytes;
    metadata.fingerprintTruncated = truncated;
    metadata.responseFingerprint = fingerprintToolsDebugBytes(sample);
  } catch {
    metadata.responseInspectionFailed = true;
  }

  return metadata;
};
