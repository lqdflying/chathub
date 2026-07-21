import { TRPCLink, createTRPCClient, httpBatchLink, httpLink, splitLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { observable } from '@trpc/server/observable';
import debug from 'debug';
import { ModelProvider } from 'model-bank';
import superjson from 'superjson';

import {
  CHATHUB_RPC_DIAGNOSTIC_OPERATIONS,
  CHATHUB_RPC_DIAGNOSTIC_OPERATION_HEADER,
  CHATHUB_TOOLS_DIAGNOSTIC_HEADER,
  CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN,
  type ChatHubRPCDiagnosticOperation,
} from '@/const/tools';
import { isDesktop } from '@/const/version';
import type { LambdaRouter } from '@/server/routers/lambda';

import { TOOLS_DIAGNOSTIC_CONTEXT_KEY } from './tools';
import { createGuardedRPCFetch, findRPCResponseError } from './toolsResponse';

const log = debug('lobe-image:lambda-client');

type FetchInit = Parameters<typeof fetch>[1];
type HeadersInput = ConstructorParameters<typeof Headers>[0];

type LambdaClientOptions = {
  desktop?: boolean;
  fetch?: typeof fetch;
  getAuthHeaders?: () => Promise<HeadersInput>;
};

// 401 error debouncing: prevent showing multiple login notifications in short time
let last401Time = 0;
const MIN_401_INTERVAL = 5000; // 5 seconds

const diagnosticIdFromContext = (context: Record<string, unknown> | undefined) => {
  const value = context?.[TOOLS_DIAGNOSTIC_CONTEXT_KEY];
  return typeof value === 'string' && CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN.test(value)
    ? value
    : undefined;
};

const diagnosticOperationFromContext = (
  context: Record<string, unknown> | undefined,
): ChatHubRPCDiagnosticOperation | undefined => {
  const value = context?.diagnosticOperation;
  return typeof value === 'string' &&
    CHATHUB_RPC_DIAGNOSTIC_OPERATIONS.includes(value as ChatHubRPCDiagnosticOperation)
    ? (value as ChatHubRPCDiagnosticOperation)
    : undefined;
};

const isAbortError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const cause =
    error && typeof error === 'object' ? (error as { cause?: unknown }).cause : undefined;
  const causeName =
    cause && typeof cause === 'object' ? (cause as { name?: unknown }).name : undefined;

  return (
    (error instanceof Error && error.name === 'AbortError') ||
    causeName === 'AbortError' ||
    message.includes('aborted') ||
    message.includes('signal is aborted without reason')
  );
};

const safeRPCErrorMessage = (error: unknown) => {
  const responseError = findRPCResponseError(error);
  if (!responseError) return error instanceof Error ? error.message : 'Request failed';

  const diagnosticSuffix = responseError.details.diagnosticId
    ? ` Diagnostic ID: ${responseError.details.diagnosticId}.`
    : '';
  return `The application gateway returned an unusable ${responseError.details.bodyKind} response.${diagnosticSuffix}`;
};

// Handle Lambda RPC errors and keep invalid proxy bodies out of user-visible notifications.
const errorHandlingLink: TRPCLink<LambdaRouter> = () => {
  return ({ op, next }) =>
    observable((observer) =>
      next(op).subscribe({
        complete: () => observer.complete(),
        error: async (err) => {
          const showError = (op.context?.showNotification as boolean) ?? true;
          const responseError = findRPCResponseError(err);
          const status =
            (err.data?.httpStatus as number | undefined) ?? responseError?.details.httpStatus;

          if (showError && !isAbortError(err)) {
            const { loginRequired } = await import('@/components/Error/loginRequiredNotification');
            const { fetchErrorNotification } =
              await import('@/components/Error/fetchErrorNotification');

            switch (status) {
              case 401: {
                const now = Date.now();
                if (now - last401Time > MIN_401_INTERVAL) {
                  last401Time = now;
                  loginRequired.redirect();
                }
                err.meta = { ...err.meta, shouldRetry: false };
                break;
              }

              default: {
                fetchErrorNotification.error({
                  errorMessage: safeRPCErrorMessage(err),
                  status,
                });
              }
            }
          }

          observer.error(err);
        },
        next: (value) => observer.next(value),
      }),
    );
};

const defaultGetAuthHeaders = async (): Promise<HeadersInput> => {
  const { createHeaderWithAuth } = await import('@/services/_auth');

  let provider: ModelProvider = ModelProvider.OpenAI;
  log('Getting provider from store for image page: %s', location.pathname);
  if (location.pathname === '/image') {
    const { getImageStoreState } = await import('@/store/image');
    const { imageGenerationConfigSelectors } =
      await import('@/store/image/slices/generationConfig/selectors');
    provider = imageGenerationConfigSelectors.provider(getImageStoreState()) as ModelProvider;
    log('Getting provider from store for image page: %s', provider);
  }

  const headers = await createHeaderWithAuth({ provider });
  log('Headers: %O', headers);
  return headers;
};

const createLambdaLinks = ({
  desktop = isDesktop,
  fetch: customFetch,
  getAuthHeaders = defaultGetAuthHeaders,
}: LambdaClientOptions = {}) => {
  const fetchImpl: typeof fetch = customFetch
    ? customFetch
    : async (input, init) => {
        if (desktop) {
          const { desktopRemoteRPCFetch } = await import('@/utils/electron/desktopRemoteRPCFetch');
          const response = await desktopRemoteRPCFetch(input as string, init as FetchInit);
          if (response) return response;
        }

        return globalThis.fetch(input, init);
      };
  const guardedFetch = createGuardedRPCFetch(fetchImpl);

  const headersForDiagnostics = async (
    diagnosticId?: string,
    diagnosticOperation?: ChatHubRPCDiagnosticOperation,
  ) => {
    const headers = new Headers(await getAuthHeaders());
    if (diagnosticId) headers.set(CHATHUB_TOOLS_DIAGNOSTIC_HEADER, diagnosticId);
    if (diagnosticOperation) {
      headers.set(CHATHUB_RPC_DIAGNOSTIC_OPERATION_HEADER, diagnosticOperation);
    }
    return Object.fromEntries(headers.entries());
  };

  const isolatedLink = httpLink<LambdaRouter>({
    fetch: guardedFetch,
    headers: ({ op }) =>
      headersForDiagnostics(
        diagnosticIdFromContext(op.context),
        diagnosticOperationFromContext(op.context),
      ),
    transformer: superjson,
    url: '/trpc/lambda',
  });

  const batchedLink = httpBatchLink<LambdaRouter>({
    fetch: guardedFetch,
    headers: ({ opList }) =>
      headersForDiagnostics(
        opList.map((op) => diagnosticIdFromContext(op.context)).find(Boolean),
        opList.map((op) => diagnosticOperationFromContext(op.context)).find(Boolean),
      ),
    maxURLLength: 2083,
    transformer: superjson,
    url: '/trpc/lambda',
  });

  return [
    errorHandlingLink,
    splitLink({
      condition: (op) => !!diagnosticIdFromContext(op.context),
      false: batchedLink,
      true: isolatedLink,
    }),
  ];
};

export const createLambdaClient = (options: LambdaClientOptions = {}) =>
  createTRPCClient<LambdaRouter>({ links: createLambdaLinks(options) });

const links = createLambdaLinks();

export const lambdaClient = createTRPCClient<LambdaRouter>({ links });

export const lambdaQuery = createTRPCReact<LambdaRouter>();

export const lambdaQueryClient = lambdaQuery.createClient({ links });
