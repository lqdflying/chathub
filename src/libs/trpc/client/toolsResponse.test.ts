import { describe, expect, it, vi } from 'vitest';

import { CHATHUB_TOOLS_DIAGNOSTIC_HEADER } from '@/const/tools';

import {
  ToolsRPCResponseError,
  createGuardedToolsFetch,
  findToolsRPCResponseError,
} from './toolsResponse';

const diagnosticHeaders = {
  [CHATHUB_TOOLS_DIAGNOSTIC_HEADER]: 'td_1234567890abcdef',
};

describe('createGuardedToolsFetch', () => {
  it('classifies an HTML gateway response without retaining its body', async () => {
    const secretHtml = '<!DOCTYPE html><html><body>token=private-sentinel</body></html>';
    const guardedFetch = createGuardedToolsFetch(
      vi.fn(async () =>
        new Response(secretHtml, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            server: 'nginx',
            'x-request-id': 'private-request-id',
          },
          status: 502,
        }),
      ) as typeof fetch,
    );

    const response = await guardedFetch('/trpc/tools/mcp.callTool', {
      headers: diagnosticHeaders,
    });

    const error = await response.json().catch((cause) => cause);
    expect(error).toBeInstanceOf(ToolsRPCResponseError);
    expect(error.details).toMatchObject({
      bodyBytes: secretHtml.length,
      bodyKind: 'html',
      diagnosticId: 'td_1234567890abcdef',
      failurePhase: 'response_parse',
      htmlMarker: 'doctype',
      httpStatus: 502,
      mediaType: 'text/html',
      reason: 'response_parse_failed',
    });
    expect(error.details.responseFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(error.details.gateway).toMatchObject({ server: 'nginx' });
    expect(JSON.stringify(error)).not.toContain('private-sentinel');
    expect(error.message).not.toContain('Unexpected token');
    expect(error.message).not.toContain('<!DOCTYPE');
  });

  it('detects HTML mislabeled as application/json', async () => {
    const guardedFetch = createGuardedToolsFetch(
      vi.fn(async () =>
        new Response('<html>gateway failure</html>', {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ) as typeof fetch,
    );

    const response = await guardedFetch('/trpc/tools/mcp.callTool', {
      headers: diagnosticHeaders,
    });
    const error = await response.json().catch((cause) => cause);

    expect(error.details).toMatchObject({
      bodyKind: 'html',
      htmlMarker: 'html_tag',
      httpStatus: 200,
      mediaType: 'application/json',
    });
  });

  it('drops untrusted diagnostic and gateway header values', async () => {
    const guardedFetch = createGuardedToolsFetch(
      vi.fn(async () =>
        new Response('<html>gateway failure</html>', {
          headers: {
            [CHATHUB_TOOLS_DIAGNOSTIC_HEADER]: 'private-diagnostic-value',
            'content-type': 'text/html',
            server: 'Bearer private-gateway-token',
          },
          status: 502,
        }),
      ) as typeof fetch,
    );

    const response = await guardedFetch('/trpc/tools/mcp.callTool');
    const error = await response.json().catch((cause) => cause);

    expect(error.details.diagnosticId).toBeUndefined();
    expect(error.details.gateway).toBeUndefined();
    expect(JSON.stringify(error)).not.toMatch(/private-diagnostic-value|private-gateway-token/);
  });

  it('classifies truncated JSON', async () => {
    const guardedFetch = createGuardedToolsFetch(
      vi.fn(async () =>
        new Response('{"result":', {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ) as typeof fetch,
    );

    const response = await guardedFetch('/trpc/tools/mcp.callTool', {
      headers: diagnosticHeaders,
    });
    const error = await response.json().catch((cause) => cause);
    expect(error.details.bodyKind).toBe('truncated_json');
  });

  it('classifies response stream read failures without retaining their message', async () => {
    const upstreamResponse = new Response('{"result":true}', {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
    vi.spyOn(upstreamResponse, 'arrayBuffer').mockRejectedValue(
      Object.assign(new TypeError('terminated while reading private upstream bytes'), {
        code: 'ECONNRESET',
      }),
    );
    const guardedFetch = createGuardedToolsFetch(
      vi.fn(async () => upstreamResponse) as typeof fetch,
    );

    const response = await guardedFetch('/trpc/tools/mcp.callTool', {
      headers: diagnosticHeaders,
    });
    const error = await response.json().catch((cause) => cause);

    expect(error.details).toMatchObject({
      bodyKind: 'unreadable',
      errorClass: 'TypeError',
      errorCode: 'ECONNRESET',
      failurePhase: 'response_read',
      httpStatus: 200,
      reason: 'response_read_failed',
    });
    expect(JSON.stringify(error)).not.toContain('private upstream bytes');
  });

  it('passes valid JSON through unchanged', async () => {
    const guardedFetch = createGuardedToolsFetch(
      vi.fn(async () =>
        new Response('{"result":{"data":"ok"}}', {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ) as typeof fetch,
    );

    const response = await guardedFetch('/trpc/tools/mcp.callTool', {
      headers: diagnosticHeaders,
    });
    await expect(response.json()).resolves.toEqual({ result: { data: 'ok' } });
  });

  it('turns network failures into safe typed errors while preserving aborts', async () => {
    const networkFetch = createGuardedToolsFetch(
      vi.fn(async () => {
        throw Object.assign(new Error('fetch failed at https://secret.example/?token=private'), {
          code: 'ECONNRESET',
        });
      }) as typeof fetch,
    );

    const networkError = await networkFetch('/trpc/tools/mcp.callTool', {
      headers: diagnosticHeaders,
    }).catch((cause) => cause);
    expect(findToolsRPCResponseError(networkError)?.details).toMatchObject({
      bodyKind: 'network_error',
      diagnosticId: 'td_1234567890abcdef',
      errorClass: 'Error',
      errorCode: 'ECONNRESET',
      failurePhase: 'network',
      reason: 'network_error',
      timedOut: false,
    });
    expect(JSON.stringify(networkError)).not.toContain('secret.example');

    const abort = new DOMException('AbortError', 'AbortError');
    const abortFetch = createGuardedToolsFetch(
      vi.fn(async () => {
        throw abort;
      }) as typeof fetch,
    );
    await expect(abortFetch('/trpc/tools/mcp.callTool')).rejects.toBe(abort);

    const abortController = new AbortController();
    const webKitAbortFetch = createGuardedToolsFetch(
      vi.fn(async () => {
        abortController.abort();
        throw new TypeError('Load failed');
      }) as typeof fetch,
    );
    const webKitAbortError = await webKitAbortFetch('/trpc/tools/mcp.callTool', {
      signal: abortController.signal,
    }).catch((cause) => cause);

    expect(webKitAbortError).toBeInstanceOf(TypeError);
    expect(findToolsRPCResponseError(webKitAbortError)).toBeUndefined();
  });
});
