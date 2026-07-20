import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { NextRequest } from 'next/server';

import {
  CHATHUB_TOOLS_DIAGNOSTIC_HEADER,
  CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN,
} from '@/const/tools';
import { pino } from '@/libs/logger';
import { protectExternalToolsDiagnosticId } from '@/libs/logger/modelCacheDebug';
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
import { lambdaRouter } from '@/server/routers/lambda';

const getProcedures = (req: NextRequest) => {
  const path = new URL(req.url).pathname.split('/trpc/lambda/')[1] || 'unknown';
  return path.split(',').filter(Boolean).slice(0, 20);
};

const handleRPCRequest = (
  req: NextRequest,
  onHandlerError?: (metadata: { error: unknown; path?: string; type: string }) => void,
) =>
  fetchRequestHandler({
    /**
     * @link https://trpc.io/docs/v11/context
     */
    createContext: () => createLambdaContext(req),

    endpoint: '/trpc/lambda',

    onError: ({ error, path, type }) => {
      onHandlerError?.({ error, path, type });
      pino.info(`Error in tRPC handler (lambda) on path: ${path}, type: ${type}`);
      console.error(error);
    },

    req,
    responseMeta({ ctx }) {
      const headers = ctx?.resHeaders;

      return { headers };
    },
    router: lambdaRouter,
  });

const handler = async (req: NextRequest) => {
  const start = Date.now();
  pino.debug(`tRPC lambda request: ${req.method} ${req.nextUrl.pathname}`);

  const requestedDiagnosticId = req.headers.get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER);
  const diagnosticId =
    requestedDiagnosticId && CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN.test(requestedDiagnosticId)
      ? protectExternalToolsDiagnosticId(requestedDiagnosticId) || createToolsDiagnosticId()
      : undefined;

  if (!diagnosticId) {
    return handleRPCRequest(req).finally(() => {
      pino.debug(`tRPC lambda response in ${Date.now() - start}ms`);
    });
  }

  const procedures = getProcedures(req);
  const procedure = procedures.length === 1 ? procedures[0] : 'batch';

  return runWithToolsDebugContext(
    {
      diagnosticId,
      operation: 'persist_tool_result',
      runtime: 'server',
      transport: 'http',
    },
    async () => {
      logToolsDebugRuntimeInitialized({ deploymentMode: process.env.NODE_ENV });
      logToolsDebugSafe('tool_persistence_rpc_started', {
        batchSize: Math.max(1, procedures.length),
        endpoint: '/trpc/lambda',
        method: req.method,
        procedure,
        procedures,
        requestBytes: parseToolsDebugContentLength(req.headers.get('content-length')),
      });

      try {
        const response = await handleRPCRequest(req, ({ error, path, type }) => {
          logToolsDebugSafe('tool_persistence_rpc_handler_error', {
            ...describeToolsDebugError(error),
            failurePhase: 'trpc_handler',
            operation: type,
            procedure: path || 'unknown',
          });
        });

        try {
          response.headers.set(CHATHUB_TOOLS_DIAGNOSTIC_HEADER, diagnosticId);
        } catch {
          // A missing response header must never affect the RPC response.
        }

        logToolsDebugSafe('tool_persistence_rpc_complete', {
          batchSize: Math.max(1, procedures.length),
          durationMs: Date.now() - start,
          endpoint: '/trpc/lambda',
          procedure,
          response: await summarizeToolsDebugResponse(response),
        });
        return response;
      } catch (error) {
        logToolsDebugSafe('tool_persistence_rpc_failed', {
          ...describeToolsDebugError(error),
          batchSize: Math.max(1, procedures.length),
          durationMs: Date.now() - start,
          endpoint: '/trpc/lambda',
          failurePhase: 'route_handler',
          procedure,
        });
        throw error;
      } finally {
        pino.debug(`tRPC lambda response in ${Date.now() - start}ms`);
      }
    },
  );
};

export { handler as GET, handler as POST };
