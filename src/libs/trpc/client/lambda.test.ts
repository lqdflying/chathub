import { describe, expect, it, vi } from 'vitest';

import {
  CHATHUB_RPC_DIAGNOSTIC_OPERATION_HEADER,
  CHATHUB_TOOLS_DIAGNOSTIC_HEADER,
} from '@/const/tools';

import { createLambdaClient } from './lambda';
import { TOOLS_DIAGNOSTIC_CONTEXT_KEY } from './tools';
import { findRPCResponseError } from './toolsResponse';

const trpcResult = (value: unknown) => ({ result: { data: { json: value } } });

describe('lambda tRPC client links', () => {
  it('isolates a correlated message update and sends its diagnostic metadata', async () => {
    const urls: string[] = [];
    const diagnosticIds: string[] = [];
    const diagnosticOperations: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(input.toString());
      diagnosticIds.push(new Headers(init?.headers).get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER) || '');
      diagnosticOperations.push(
        new Headers(init?.headers).get(CHATHUB_RPC_DIAGNOSTIC_OPERATION_HEADER) || '',
      );
      return new Response(JSON.stringify(trpcResult(null)), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }) as typeof fetch;
    const client = createLambdaClient({
      desktop: false,
      fetch: fetchMock,
      getAuthHeaders: async () => ({}),
    });

    await client.message.update.mutate(
      { id: 'message-id', value: { content: '{"ok":true}' } },
      {
        context: {
          diagnosticOperation: 'finalize_assistant_message',
          [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: 'td_1234567890abcdef',
          showNotification: false,
        },
      },
    );

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/trpc/lambda/message.update');
    expect(urls[0]).not.toContain('batch=1');
    expect(diagnosticIds).toEqual(['td_1234567890abcdef']);
    expect(diagnosticOperations).toEqual(['finalize_assistant_message']);
  });

  it('classifies an HTML Lambda response without exposing its parser text or body', async () => {
    const client = createLambdaClient({
      desktop: false,
      fetch: vi.fn(
        async () =>
          new Response('<!DOCTYPE html><html><body>private proxy page</body></html>', {
            headers: {
              'content-type': 'text/html',
              'server': 'nginx',
              'x-cache': 'gateway-miss',
              'x-envoy-upstream-service-time': '321',
              'x-request-id': 'private-request-id',
            },
            status: 502,
          }),
      ) as typeof fetch,
      getAuthHeaders: async () => ({}),
    });

    const error = await client.message.update
      .mutate(
        { id: 'message-id', value: { content: '{"ok":true}' } },
        {
          context: {
            diagnosticOperation: 'finalize_assistant_message',
            [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: 'td_1234567890abcdef',
            showNotification: false,
          },
        },
      )
      .catch((cause) => cause);

    expect(findRPCResponseError(error)?.details).toMatchObject({
      bodyKind: 'html',
      diagnosticId: 'td_1234567890abcdef',
      failurePhase: 'response_parse',
      htmlMarker: 'doctype',
      httpStatus: 502,
      mediaType: 'text/html',
      operation: 'finalize_assistant_message',
      reason: 'response_parse_failed',
    });
    expect(findRPCResponseError(error)?.details.gateway).toMatchObject({
      cacheStatus: 'gateway-miss',
      requestIdHash: expect.stringMatching(/^[\da-f]{16}$/),
      server: 'nginx',
      upstreamDurationMs: 321,
    });
    expect(JSON.stringify(error)).not.toContain('private proxy page');
    expect(JSON.stringify(error)).not.toContain('private-request-id');
    expect(JSON.stringify(error)).not.toContain('<!DOCTYPE');
    expect(JSON.stringify(error)).not.toContain('Unexpected token');
  });
});
