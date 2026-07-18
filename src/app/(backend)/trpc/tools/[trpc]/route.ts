import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { NextRequest } from 'next/server';

import {
  CHATHUB_TOOLS_DIAGNOSTIC_HEADER,
  CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN,
} from '@/const/tools';
import { pino } from '@/libs/logger';
import {
  TOOL_DEBUG_FINGERPRINT_BYTES,
  createToolsDiagnosticId,
  describeToolsDebugError,
  fingerprintToolsDebugBytes,
  isToolsDebugEnabled,
  logToolsDebugRuntimeInitialized,
  logToolsDebugSafe,
  runWithToolsDebugContext,
} from '@/libs/logger/toolsDebug';
import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { toolsRouter } from '@/server/routers/tools';

const normalizeMediaType = (value: string | null) =>
  value?.split(';', 1)[0].trim().toLowerCase() || undefined;

const parseContentLength = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const summarizeResponse = async (response: Response) => {
  const mediaType = normalizeMediaType(response.headers.get('content-type'));
  const metadata: Record<string, unknown> = {
    contentEncoding: response.headers.get('content-encoding') || undefined,
    contentLength: parseContentLength(response.headers.get('content-length')),
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

const handler = async (req: NextRequest) => {
  const requestedDiagnosticId = req.headers.get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER);
  const diagnosticId =
    requestedDiagnosticId && CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN.test(requestedDiagnosticId)
      ? requestedDiagnosticId
      : createToolsDiagnosticId();
  const path = new URL(req.url).pathname.split('/trpc/tools/')[1] || 'unknown';
  const procedures = path.split(',').filter(Boolean).slice(0, 20);
  const startedAt = Date.now();

  return runWithToolsDebugContext(
    {
      diagnosticId,
      operation: procedures.length === 1 ? procedures[0] : 'tools_rpc_batch',
      runtime: 'server',
      transport: 'http',
    },
    async () => {
      logToolsDebugRuntimeInitialized({ deploymentMode: process.env.NODE_ENV });
      logToolsDebugSafe('tools_rpc_started', {
        batchSize: Math.max(1, procedures.length),
        method: req.method,
        procedure: procedures.length === 1 ? procedures[0] : 'batch',
        procedures,
        requestBytes: parseContentLength(req.headers.get('content-length')),
      });

      try {
        const response = await fetchRequestHandler({
          /**
           * @link https://trpc.io/docs/v11/context
           */
          createContext: () => createLambdaContext(req),

          endpoint: '/trpc/tools',

          onError: ({ error, path: errorPath, type }) => {
            logToolsDebugSafe('tools_rpc_handler_error', {
              ...describeToolsDebugError(error),
              failurePhase: 'trpc_handler',
              operation: type,
              procedure: errorPath || 'unknown',
            });
            pino.info(`Error in tRPC handler (tools) on path: ${errorPath}, type: ${type}`);
          },

          req,
          router: toolsRouter,
        });

        try {
          response.headers.set(CHATHUB_TOOLS_DIAGNOSTIC_HEADER, diagnosticId);
        } catch {
          // A missing response header must never affect the RPC response.
        }
        logToolsDebugSafe('tools_rpc_complete', {
          batchSize: Math.max(1, procedures.length),
          durationMs: Date.now() - startedAt,
          procedure: procedures.length === 1 ? procedures[0] : 'batch',
          response: await summarizeResponse(response),
        });
        return response;
      } catch (error) {
        logToolsDebugSafe('tools_rpc_failed', {
          ...describeToolsDebugError(error),
          batchSize: Math.max(1, procedures.length),
          durationMs: Date.now() - startedAt,
          failurePhase: 'route_handler',
          procedure: procedures.length === 1 ? procedures[0] : 'batch',
        });
        throw error;
      }
    },
  );
};

export { handler as GET, handler as POST };
