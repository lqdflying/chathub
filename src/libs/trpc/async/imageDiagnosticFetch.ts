import {
  bindImageDebugContext,
  describeImageDebugError,
  getImageDebugContext,
  isImageDebugEnabled,
  logImageDebugSafe,
} from '@/libs/logger/imageDebug';
import {
  createImageDebugResponseBodySample,
  summarizeImageDebugResponse,
} from '@/libs/logger/imageResponseDebug';

type FetchInit = Parameters<typeof fetch>[1];
type FetchInput = Parameters<typeof fetch>[0];

const isAbortError = (error: unknown, signal?: AbortSignal) => {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === 'AbortError';
};

const shouldLogImageTransport = () =>
  !!getImageDebugContext()?.diagnosticId && isImageDebugEnabled();

export const createImageDiagnosticFetch = (fetchFn: typeof fetch): typeof fetch =>
  (async (input: FetchInput, init?: FetchInit) => {
    const startedAt = Date.now();
    let response: Response;

    try {
      response = await fetchFn(input, init);
    } catch (error) {
      if (!isAbortError(error, init?.signal) && shouldLogImageTransport()) {
        logImageDebugSafe('dispatch_settled', {
          ...describeImageDebugError(error),
          durationMs: Date.now() - startedAt,
          failurePhase: 'network',
          outcome: 'failed',
          phase: 'dispatch_http',
        });
      }
      throw error;
    }

    if (shouldLogImageTransport()) {
      logImageDebugSafe('dispatch_settled', {
        durationMs: Date.now() - startedAt,
        outcome: response.ok ? 'completed' : 'failed',
        phase: 'dispatch_http',
        response: summarizeImageDebugResponse(response),
      });
    }

    const parseJson = bindImageDebugContext(async () => {
      let bodyText: string;
      try {
        bodyText = await response.text();
      } catch (error) {
        if (shouldLogImageTransport() && !isAbortError(error, init?.signal)) {
          logImageDebugSafe('dispatch_settled', {
            ...describeImageDebugError(error),
            durationMs: Date.now() - startedAt,
            failurePhase: 'response_read',
            outcome: 'failed',
            phase: 'dispatch_http_parse',
            response: summarizeImageDebugResponse(response),
          });
        }
        throw error;
      }

      try {
        const parsedBody = JSON.parse(bodyText);
        if (shouldLogImageTransport()) {
          logImageDebugSafe('dispatch_settled', {
            durationMs: Date.now() - startedAt,
            outcome: 'completed',
            phase: 'dispatch_http_parse',
            response: summarizeImageDebugResponse(
              response,
              createImageDebugResponseBodySample(bodyText),
            ),
          });
        }

        return parsedBody;
      } catch (error) {
        if (shouldLogImageTransport() && !isAbortError(error, init?.signal)) {
          logImageDebugSafe('dispatch_settled', {
            ...describeImageDebugError(error),
            durationMs: Date.now() - startedAt,
            failurePhase: 'response_parse',
            outcome: 'failed',
            phase: 'dispatch_http_parse',
            response: summarizeImageDebugResponse(
              response,
              createImageDebugResponseBodySample(bodyText),
            ),
          });
        }
        throw error;
      }
    });

    return new Proxy(response, {
      get(target, property) {
        if (property === 'json') {
          return parseJson;
        }

        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }) as typeof fetch;
