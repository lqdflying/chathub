import { describe, expect, it, vi } from 'vitest';

import { CHATHUB_TOOLS_DIAGNOSTIC_HEADER } from '@/const/tools';

import { TOOLS_DIAGNOSTIC_CONTEXT_KEY, createToolsClient } from './tools';
import { findToolsRPCResponseError } from './toolsResponse';

const trpcResult = (value: unknown) => ({ result: { data: { json: value } } });

describe('tools tRPC client links', () => {
  it('sends concurrent mcp.callTool mutations as independent requests', async () => {
    const diagnosticIds: string[] = [];
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(input.toString());
      diagnosticIds.push(new Headers(init?.headers).get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER) || '');
      return new Response(JSON.stringify(trpcResult({ content: 'ok', persistence: 'persisted' })), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }) as typeof fetch;
    const client = createToolsClient({
      desktop: false,
      fetch: fetchMock,
      getAuthHeaders: async () => ({}),
    });

    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        client.mcp.callTool.mutate(
          {
            args: '{}',
            messageId: `message-${index}`,
            params: {
              auth: { type: 'none' },
              name: 'test-connection',
              type: 'http',
              url: 'https://mcp.example.com',
            },
            toolName: `tool-${index}`,
          },
          { context: { [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: `td_1234567890abcde${index}` } },
        ),
      ),
    );

    expect(urls).toHaveLength(4);
    expect(urls.every((url) => url.includes('/trpc/tools/mcp.callTool'))).toBe(true);
    expect(urls.every((url) => !url.includes('batch=1'))).toBe(true);
    expect(diagnosticIds.sort()).toEqual(
      Array.from({ length: 4 }, (_, index) => `td_1234567890abcde${index}`).sort(),
    );
  });

  it('keeps unrelated tools procedures batchable', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(input.toString());
      return new Response(JSON.stringify([trpcResult([]), trpcResult([])]), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }) as typeof fetch;
    const client = createToolsClient({
      desktop: false,
      fetch: fetchMock,
      getAuthHeaders: async () => ({}),
    });
    const params = {
      auth: { type: 'none' as const },
      name: 'test-connection',
      type: 'http' as const,
      url: 'https://mcp.example.com',
    };

    await Promise.all([
      client.mcp.listResources.query(params),
      client.mcp.listResources.query(params),
    ]);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('mcp.listResources,mcp.listResources');
    expect(urls[0]).toContain('batch=1');
  });

  it('isolates explicitly correlated built-in tool requests', async () => {
    const diagnosticIds: string[] = [];
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(input.toString());
      diagnosticIds.push(new Headers(init?.headers).get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER) || '');
      return new Response(
        JSON.stringify(
          trpcResult({
            costTime: 1,
            query: 'test',
            resultNumbers: 0,
            results: [],
          }),
        ),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      );
    }) as typeof fetch;
    const client = createToolsClient({
      desktop: false,
      fetch: fetchMock,
      getAuthHeaders: async () => ({}),
    });

    await Promise.all(
      ['td_1234567890abcdef', 'td_abcdef1234567890'].map((diagnosticId) =>
        client.search.webSearch.query(
          { query: 'test' },
          { context: { [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: diagnosticId } },
        ),
      ),
    );

    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes('/trpc/tools/search.webSearch'))).toBe(true);
    expect(urls.every((url) => !url.includes('batch=1'))).toBe(true);
    expect(diagnosticIds.sort()).toEqual(['td_1234567890abcdef', 'td_abcdef1234567890'].sort());
  });

  it('isolates completion telemetry so each report keeps its diagnostic ID', async () => {
    const diagnosticIds: string[] = [];
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(input.toString());
      diagnosticIds.push(new Headers(init?.headers).get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER) || '');
      return new Response(JSON.stringify(trpcResult({ reported: true })), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }) as typeof fetch;
    const client = createToolsClient({
      desktop: false,
      fetch: fetchMock,
      getAuthHeaders: async () => ({}),
    });

    const result = {
      serializedLength: 2,
      type: 'string' as const,
      valueHash: '0123456789abcdef',
    };
    const correlation = {
      toolCallCount: 2,
      toolCallSetHash: 'fedcba9876543210',
    };

    await Promise.all(
      ['td_1234567890abcdef', 'td_abcdef1234567890'].map((diagnosticId) =>
        client.telemetry.reportToolCompletion.mutate(
          {
            correlation,
            diagnosticId,
            result,
            runtimeType: 'mcp',
            toolNameHash: '0011223344556677',
          },
          { context: { [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: diagnosticId } },
        ),
      ),
    );

    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes('/trpc/tools/telemetry.reportToolCompletion'))).toBe(
      true,
    );
    expect(urls.every((url) => !url.includes('batch=1'))).toBe(true);
    expect(diagnosticIds.sort()).toEqual(['td_1234567890abcdef', 'td_abcdef1234567890'].sort());
  });

  it('isolates batch telemetry so its transport diagnostic ID remains correlated', async () => {
    const diagnosticIds: string[] = [];
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(input.toString());
      diagnosticIds.push(new Headers(init?.headers).get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER) || '');
      return new Response(JSON.stringify(trpcResult({ reported: true })), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }) as typeof fetch;
    const client = createToolsClient({
      desktop: false,
      fetch: fetchMock,
      getAuthHeaders: async () => ({}),
    });

    await Promise.all(
      ['td_1234567890abcdef', 'td_abcdef1234567890'].map((diagnosticId, index) =>
        client.telemetry.reportToolBatch.mutate(
          {
            correlation: {
              batchId: `tb_1234567890abcde${index}`,
              toolCallCount: 2,
              toolCallSetHash: 'fedcba9876543210',
            },
            phase: 'started',
          },
          { context: { [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: diagnosticId } },
        ),
      ),
    );

    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes('/trpc/tools/telemetry.reportToolBatch'))).toBe(true);
    expect(urls.every((url) => !url.includes('batch=1'))).toBe(true);
    expect(diagnosticIds.sort()).toEqual(['td_1234567890abcdef', 'td_abcdef1234567890'].sort());
  });

  it('preserves classified HTML response details through the tRPC client error', async () => {
    const client = createToolsClient({
      desktop: false,
      fetch: vi.fn(
        async () =>
          new Response('<!DOCTYPE html><html><body>private gateway page</body></html>', {
            headers: { 'content-type': 'text/html' },
            status: 502,
          }),
      ) as typeof fetch,
      getAuthHeaders: async () => ({}),
    });

    const error = await client.mcp.callTool
      .mutate(
        {
          args: '{}',
          messageId: 'message-id',
          params: {
            auth: { type: 'none' },
            name: 'test-connection',
            type: 'http',
            url: 'https://mcp.example.com',
          },
          toolName: 'test-tool',
        },
        { context: { [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: 'td_1234567890abcdef' } },
      )
      .catch((cause) => cause);

    expect(findToolsRPCResponseError(error)?.details).toMatchObject({
      bodyKind: 'html',
      diagnosticId: 'td_1234567890abcdef',
      failurePhase: 'response_parse',
      htmlMarker: 'doctype',
      httpStatus: 502,
      reason: 'response_parse_failed',
    });
    expect(JSON.stringify(error)).not.toContain('private gateway page');
    expect(JSON.stringify(error)).not.toContain('<!DOCTYPE');
  });
});
