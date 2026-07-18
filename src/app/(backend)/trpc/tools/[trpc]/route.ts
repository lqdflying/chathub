import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { NextRequest } from 'next/server';

import {
  CHATHUB_TOOLS_DIAGNOSTIC_HEADER,
  CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN,
} from '@/const/tools';
import { pino } from '@/libs/logger';
import {
  createToolsDiagnosticId,
  describeToolsDebugError,
  logToolsDebugRuntimeInitialized,
  logToolsDebugSafe,
  runWithToolsDebugContext,
} from '@/libs/logger/toolsDebug';
import {
  parseToolsDebugContentLength,
  summarizeToolsDebugResponse,
} from '@/libs/logger/toolsResponseDebug';
import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { toolsRouter } from '@/server/routers/tools';

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
        requestBytes: parseToolsDebugContentLength(req.headers.get('content-length')),
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
          response: await summarizeToolsDebugResponse(response),
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
