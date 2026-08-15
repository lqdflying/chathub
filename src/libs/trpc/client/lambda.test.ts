import { describe, expect, it, vi } from 'vitest';

import { CHATHUB_ACCOUNT_SCOPE_HEADER } from '@/const/auth';
import {
  CHATHUB_RPC_DIAGNOSTIC_OPERATION_HEADER,
  CHATHUB_TOOLS_DIAGNOSTIC_HEADER,
} from '@/const/tools';

import { createLambdaClient } from './lambda';
import { TOOLS_DIAGNOSTIC_CONTEXT_KEY } from './tools';
import { findRPCResponseError } from './toolsResponse';

// lightweight module-scope spies — the error link imports these lazily, and
// pulling the real UI trees into the test costs seconds and times it out
const { loginRedirectSpy, fetchErrorSpy } = vi.hoisted(() => ({
  fetchErrorSpy: vi.fn(),
  loginRedirectSpy: vi.fn(),
}));
vi.mock('@/components/Error/loginRequiredNotification', () => ({
  loginRequired: { redirect: loginRedirectSpy },
}));
vi.mock('@/components/Error/fetchErrorNotification', () => ({
  fetchErrorNotification: { error: fetchErrorSpy },
}));

const trpcResult = (value: unknown) => ({ result: { data: { json: value } } });

describe('lambda tRPC client links', () => {
  it('blocks account-sensitive RPCs before fetch when ownership is unverified', async () => {
    const ownershipError = new DOMException(
      'user state ownership is not initialized',
      'AbortError',
    );
    const fetchMock = vi.fn() as typeof fetch;
    const client = createLambdaClient({
      assertAccountOwnership: () => {
        throw ownershipError;
      },
      fetch: fetchMock,
      getAuthHeaders: async () => ({}),
    });

    await expect(client.apiKey.getApiKeys.query()).rejects.toMatchObject({
      message: ownershipError.message,
    });
    await expect(client.picbed.list.query()).rejects.toMatchObject({
      message: ownershipError.message,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the verified account scope with account-sensitive RPCs', async () => {
    const accountScopes: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      accountScopes.push(new Headers(init?.headers).get(CHATHUB_ACCOUNT_SCOPE_HEADER) || '');

      return new Response(JSON.stringify(trpcResult([])), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }) as typeof fetch;
    const client = createLambdaClient({
      assertAccountOwnership: () => ({
        ownershipInvalidationGeneration: 7,
        scope: 'user:account-a',
      }),
      fetch: fetchMock,
      getAuthHeaders: async () => ({}),
    });

    await client.apiKey.getApiKeys.query();
    await client.picbed.list.query();

    expect(accountScopes).toEqual(['user:account-a', 'user:account-a']);
  });

  it('allows user-state ownership bootstrap without prior verification', async () => {
    const assertAccountOwnership = vi.fn(() => ({
      ownershipInvalidationGeneration: 0,
      scope: 'user:account-a',
    }));
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify([trpcResult({ userId: 'account-a' })]), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }) as typeof fetch;
    const client = createLambdaClient({
      assertAccountOwnership,
      fetch: fetchMock,
      getAuthHeaders: async () => ({}),
    });

    await client.user.getUserState.query();

    expect(assertAccountOwnership).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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

  it.each([401, 403])(
    'suppresses the global login/fetch UI for an HTML %i when showNotification is false',
    async (status) => {
      loginRedirectSpy.mockClear();
      fetchErrorSpy.mockClear();
      const urls: string[] = [];
      const diagnosticIds: string[] = [];
      const diagnosticOperations: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(input.toString());
        diagnosticIds.push(new Headers(init?.headers).get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER) || '');
        diagnosticOperations.push(
          new Headers(init?.headers).get(CHATHUB_RPC_DIAGNOSTIC_OPERATION_HEADER) || '',
        );
        return new Response('<!DOCTYPE html><html><body>gateway page</body></html>', {
          headers: { 'content-type': 'text/html' },
          status,
        });
      }) as typeof fetch;

      const client = createLambdaClient({
        fetch: fetchMock,
        getAuthHeaders: async () => ({}),
      });

      // the finalization read-back path: suppressed notifications + isolated link
      const error = await client.message.getMessageById
        .query(
          { id: 'message-id' },
          {
            context: {
              diagnosticOperation: 'finalize_assistant_message',
              [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: 'td_1234567890abcdef',
              showNotification: false,
            },
          },
        )
        .catch((cause) => cause);

      // the read is DIRECTLY non-batched and carries the shared diagnostic
      // metadata — this is what keeps it off any shared batch request
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain('/trpc/lambda/message.getMessageById');
      expect(urls[0]).not.toContain('batch=1');
      expect(diagnosticIds).toEqual(['td_1234567890abcdef']);
      expect(diagnosticOperations).toEqual(['finalize_assistant_message']);

      // the caller still receives the classified failure (fail-closed), but no
      // global login modal or generic fetch notification ever fires
      expect(findRPCResponseError(error)?.details).toMatchObject({
        bodyKind: 'html',
        httpStatus: status,
      });
      expect(loginRedirectSpy).not.toHaveBeenCalled();
      expect(fetchErrorSpy).not.toHaveBeenCalled();
    },
  );
});
