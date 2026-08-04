import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { NextRequest } from 'next/server';

import {
  CHATHUB_IMAGE_DIAGNOSTIC_HEADER,
  CHATHUB_KNOWLEDGE_DIAGNOSTIC_HEADER,
} from '@/const/tools';
import { pino } from '@/libs/logger';
import {
  describeImageDebugError,
  logImageDebugSafe,
  runWithImageDebugContext,
} from '@/libs/logger/imageDebug';
import {
  parseImageDebugContentLength,
  summarizeImageDebugResponse,
} from '@/libs/logger/imageResponseDebug';
import {
  describeKnowledgeDebugError,
  logKnowledgeDebugSafe,
  runWithKnowledgeDebugContext,
} from '@/libs/logger/knowledgeDebug';
import {
  createAsyncRouteContext,
  getTrustedImageDiagnosticId,
  getTrustedKnowledgeDiagnosticId,
} from '@/libs/trpc/async/context';
import { asyncRouter } from '@/server/routers/async';

const getProcedure = (req: NextRequest) =>
  new URL(req.url).pathname.split('/trpc/async/')[1] || 'unknown';

const handleRPCRequest = (
  req: NextRequest,
  onHandlerError?: (metadata: { error: unknown; path?: string; type: string }) => void,
) =>
  fetchRequestHandler({
    // 避免请求之间互相影响
    // https://github.com/lobehub/lobe-chat/discussions/7442#discussioncomment-13658563
    allowBatching: false,

    /**
     * @link https://trpc.io/docs/v11/context
     */
    createContext: () => createAsyncRouteContext(req),

    endpoint: '/trpc/async',

    onError: ({ error, path, type }) => {
      onHandlerError?.({ error, path, type });
      pino.info(`Error in tRPC handler (async) on path: ${path}, type: ${type}`);
      console.error(error);
    },

    req,
    router: asyncRouter,
  });

const handler = async (req: NextRequest) => {
  const start = Date.now();
  pino.debug(`tRPC async request: ${req.method} ${req.nextUrl.pathname}`);
  const procedure = getProcedure(req);
  const diagnosticId = getTrustedImageDiagnosticId(req);
  const knowledgeDiagnosticId = getTrustedKnowledgeDiagnosticId(req);
  let handlerFailed = false;

  const markHandlerFailed = () => {
    handlerFailed = true;
  };

  const execute = async () => {
    if (!diagnosticId) {
      return handleRPCRequest(req, markHandlerFailed).finally(() => {
        pino.debug(`tRPC async response in ${Date.now() - start}ms`);
      });
    }

    return runWithImageDebugContext(
      {
        diagnosticId,
        operation: procedure,
        runtime: 'async',
        transport: 'http',
      },
      async () => {
        logImageDebugSafe('async_route_started', {
          endpoint: '/trpc/async',
          method: req.method,
          phase: 'async_route',
          procedure,
          requestBytes: parseImageDebugContentLength(req.headers.get('content-length')),
        });

        try {
          const response = await handleRPCRequest(req, markHandlerFailed);

          try {
            response.headers.set(CHATHUB_IMAGE_DIAGNOSTIC_HEADER, diagnosticId);
          } catch {
            // A missing response header must never affect the RPC response.
          }

          const requestFailed = handlerFailed || !response.ok;
          logImageDebugSafe('async_route_settled', {
            durationMs: Date.now() - start,
            failurePhase: handlerFailed
              ? 'trpc_handler'
              : response.ok
                ? undefined
                : 'http_response',
            outcome: requestFailed ? 'failed' : 'completed',
            phase: 'async_route',
            procedure,
            response: summarizeImageDebugResponse(response),
          });
          return response;
        } catch (error) {
          logImageDebugSafe('async_route_settled', {
            ...describeImageDebugError(error),
            durationMs: Date.now() - start,
            failurePhase: 'route_handler',
            outcome: 'failed',
            phase: 'async_route',
            procedure,
          });
          throw error;
        } finally {
          pino.debug(`tRPC async response in ${Date.now() - start}ms`);
        }
      },
    );
  };

  if (!knowledgeDiagnosticId) return execute();

  return runWithKnowledgeDebugContext(
    {
      diagnosticId: knowledgeDiagnosticId,
      operation: procedure,
      runtime: 'async',
      transport: 'http',
    },
    async () => {
      logKnowledgeDebugSafe('async_route_started', {
        method: req.method,
        phase: 'async_route',
      });

      try {
        const response = await execute();
        try {
          response.headers.set(CHATHUB_KNOWLEDGE_DIAGNOSTIC_HEADER, knowledgeDiagnosticId);
        } catch {
          // Diagnostic response headers are best effort.
        }
        logKnowledgeDebugSafe('async_route_settled', {
          durationMs: Date.now() - start,
          failurePhase: handlerFailed ? 'trpc_handler' : response.ok ? undefined : 'http_response',
          outcome: handlerFailed || !response.ok ? 'failed' : 'completed',
          phase: 'async_route',
          statusCode: response.status,
        });
        return response;
      } catch (error) {
        logKnowledgeDebugSafe('async_route_settled', {
          ...describeKnowledgeDebugError(error),
          durationMs: Date.now() - start,
          failurePhase: 'route_handler',
          outcome: 'failed',
          phase: 'async_route',
        });
        throw error;
      }
    },
  );
};

export { handler as GET, handler as POST };
