import { createTRPCClient, httpBatchLink, httpLink, splitLink } from '@trpc/client';
import { nanoid } from 'nanoid';
import superjson from 'superjson';

import {
  CHATHUB_TOOLS_DIAGNOSTIC_HEADER,
  CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN,
  TOOLS_DIAGNOSTIC_CONTEXT_KEY,
} from '@/const/tools';
import { isDesktop } from '@/const/version';
import type { ToolsRouter } from '@/server/routers/tools';
import { fetchWithDesktopRemoteRPC } from '@/utils/electron/desktopRemoteRPCFetch';

import { createGuardedToolsFetch } from './toolsResponse';

export { TOOLS_DIAGNOSTIC_CONTEXT_KEY } from '@/const/tools';

type FetchInit = Parameters<typeof fetch>[1];
type HeadersInput = ConstructorParameters<typeof Headers>[0];

type ToolsClientOptions = {
  desktop?: boolean;
  fetch?: typeof fetch;
  getAuthHeaders?: () => Promise<HeadersInput>;
};

const createDiagnosticId = () => `td_${nanoid(20)}`;

const defaultGetAuthHeaders = async (): Promise<HeadersInput> => {
  // Dynamic import avoids the existing auth/client circular dependency.
  const { createHeaderWithAuth } = await import('@/services/_auth');
  return createHeaderWithAuth();
};

const diagnosticIdFromContext = (context: Record<string, unknown> | undefined) => {
  const value = context?.[TOOLS_DIAGNOSTIC_CONTEXT_KEY];
  return typeof value === 'string' && CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN.test(value)
    ? value
    : undefined;
};

export const createToolsClient = ({
  desktop = isDesktop,
  fetch: customFetch,
  getAuthHeaders = defaultGetAuthHeaders,
}: ToolsClientOptions = {}) => {
  const fetchImpl: typeof fetch = customFetch
    ? customFetch
    : desktop
      ? (((input, init) =>
          fetchWithDesktopRemoteRPC(input as string, init as FetchInit)) as typeof fetch)
      : globalThis.fetch.bind(globalThis);
  const guardedFetch = createGuardedToolsFetch(fetchImpl);

  const headersWithDiagnosticId = async (diagnosticId: string) => {
    const headers = new Headers(await getAuthHeaders());
    headers.set(CHATHUB_TOOLS_DIAGNOSTIC_HEADER, diagnosticId);
    return Object.fromEntries(headers.entries());
  };

  const isolatedLink = httpLink<ToolsRouter>({
    fetch: guardedFetch,
    headers: ({ op }) =>
      headersWithDiagnosticId(diagnosticIdFromContext(op.context) || createDiagnosticId()),
    transformer: superjson,
    url: '/trpc/tools',
  });

  const batchedLink = httpBatchLink<ToolsRouter>({
    fetch: guardedFetch,
    headers: ({ opList }) =>
      headersWithDiagnosticId(
        opList.map((op) => diagnosticIdFromContext(op.context)).find(Boolean) ||
          createDiagnosticId(),
      ),
    maxURLLength: 2083,
    transformer: superjson,
    url: '/trpc/tools',
  });

  return createTRPCClient<ToolsRouter>({
    links: [
      splitLink({
        condition: (op) =>
          !!diagnosticIdFromContext(op.context) ||
          op.path === 'mcp.callTool' ||
          op.path === 'mcp.reportClientFailure' ||
          op.path === 'telemetry.reportToolBatch' ||
          op.path === 'telemetry.reportToolCompletion',
        false: batchedLink,
        true: isolatedLink,
      }),
    ],
  });
};

export const toolsClient = createToolsClient();
