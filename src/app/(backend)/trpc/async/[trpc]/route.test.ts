// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHATHUB_IMAGE_DIAGNOSTIC_HEADER,
  CHATHUB_KNOWLEDGE_DIAGNOSTIC_HEADER,
} from '@/const/tools';

import { POST } from './route';

const { fetchRequestHandlerMock } = vi.hoisted(() => ({
  fetchRequestHandlerMock: vi.fn(),
}));

vi.mock('@trpc/server/adapters/fetch', () => ({
  fetchRequestHandler: fetchRequestHandlerMock,
}));
vi.mock('@/libs/logger', () => ({
  pino: { debug: vi.fn(), info: vi.fn() },
}));
vi.mock('@/server/routers/async', () => ({ asyncRouter: {} }));
vi.mock('@/config/db', () => ({
  serverDBEnv: { KEY_VAULTS_SECRET: 'test-internal-secret' },
}));

const diagnosticId = 'ig_1234567890abcdef';
const knowledgeDiagnosticId = 'kb_1234567890abcdef';
const internalSecret = 'test-internal-secret';

const createRequest = (authorization?: string, additionalHeaders?: Record<string, string>) => {
  const headers: Record<string, string> = {
    [CHATHUB_IMAGE_DIAGNOSTIC_HEADER]: diagnosticId,
    'content-type': 'application/json',
    ...additionalHeaders,
  };
  if (authorization) headers.Authorization = authorization;

  return new NextRequest('http://localhost/trpc/async/image.createImage', {
    body: '{}',
    headers,
    method: 'POST',
  });
};

describe('Async tRPC image diagnostics ingress', () => {
  beforeEach(() => {
    vi.stubEnv('CHATHUB_IMAGE_DEBUG', '1');
    fetchRequestHandlerMock.mockResolvedValue(
      new Response('{"result":{"data":{"json":null}}}', {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('does not log or reflect an untrusted diagnostic header', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const response = await POST(createRequest());

    expect(response.headers.get(CHATHUB_IMAGE_DIAGNOSTIC_HEADER)).toBeNull();
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(diagnosticId);
  });

  it('retains a diagnostic header from an authenticated internal request', async () => {
    const response = await POST(createRequest(`Bearer ${internalSecret}`));

    expect(response.headers.get(CHATHUB_IMAGE_DIAGNOSTIC_HEADER)).toBe(diagnosticId);
  });

  it('emits one completed terminal event for a successful request', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await POST(createRequest(`Bearer ${internalSecret}`));

    const eventPrefixes = consoleSpy.mock.calls.map(([prefix]) => prefix);
    expect(eventPrefixes).toEqual([
      '[chathub-image-debug:async_route_started]',
      '[chathub-image-debug:async_route_settled]',
    ]);
    expect(JSON.parse(consoleSpy.mock.calls[1][1])).toMatchObject({
      outcome: 'completed',
      response: { httpStatus: 200 },
    });
  });

  it('reflects and logs a trusted Knowledge Base diagnostic independently', async () => {
    vi.stubEnv('CHATHUB_IMAGE_DEBUG', '0');
    vi.stubEnv('CHATHUB_KNOWLEDGE_DEBUG', '1');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const response = await POST(
      createRequest(`Bearer ${internalSecret}`, {
        [CHATHUB_KNOWLEDGE_DIAGNOSTIC_HEADER]: knowledgeDiagnosticId,
      }),
    );

    expect(response.headers.get(CHATHUB_KNOWLEDGE_DIAGNOSTIC_HEADER)).toBe(knowledgeDiagnosticId);
    expect(consoleSpy.mock.calls.map(([prefix]) => prefix)).toEqual([
      '[chathub-knowledge-debug:async_route_started]',
      '[chathub-knowledge-debug:async_route_settled]',
    ]);
  });

  it('marks a Knowledge Base route failed when tRPC reports an error in an HTTP 200 response', async () => {
    vi.stubEnv('CHATHUB_IMAGE_DEBUG', '0');
    vi.stubEnv('CHATHUB_KNOWLEDGE_DEBUG', '1');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    fetchRequestHandlerMock.mockImplementationOnce(async ({ onError }) => {
      onError({
        error: new Error('handler failed'),
        path: 'file.parseFileToChunks',
        type: 'mutation',
      });
      return new Response('{\"error\":{}}', {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    await POST(
      createRequest(`Bearer ${internalSecret}`, {
        [CHATHUB_KNOWLEDGE_DIAGNOSTIC_HEADER]: knowledgeDiagnosticId,
      }),
    );

    const settled = consoleSpy.mock.calls.find(
      ([prefix]) => prefix === '[chathub-knowledge-debug:async_route_settled]',
    );
    expect(JSON.parse(settled?.[1] as string)).toMatchObject({
      failurePhase: 'trpc_handler',
      outcome: 'failed',
      statusCode: 200,
    });
  });

  it('emits one failed terminal event for an HTTP error response', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    fetchRequestHandlerMock.mockResolvedValueOnce(
      new Response('Bad request', {
        headers: { 'content-type': 'text/plain' },
        status: 400,
      }),
    );

    await POST(createRequest(`Bearer ${internalSecret}`));

    const eventPrefixes = consoleSpy.mock.calls.map(([prefix]) => prefix);
    expect(eventPrefixes).toEqual([
      '[chathub-image-debug:async_route_started]',
      '[chathub-image-debug:async_route_settled]',
    ]);
    expect(JSON.parse(consoleSpy.mock.calls[1][1])).toMatchObject({
      failurePhase: 'http_response',
      outcome: 'failed',
      response: { httpStatus: 400 },
    });
  });

  it('emits a failed terminal event when tRPC reports a handler error', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    fetchRequestHandlerMock.mockImplementationOnce(async ({ onError }) => {
      onError({
        error: new Error('handler failed'),
        path: 'image.createImage',
        type: 'mutation',
      });
      return new Response('{\"error\":{}}', {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    await POST(createRequest(`Bearer ${internalSecret}`));

    const settledRecords = consoleSpy.mock.calls.filter(
      ([prefix]) => prefix === '[chathub-image-debug:async_route_settled]',
    );
    expect(settledRecords).toHaveLength(1);
    expect(JSON.parse(settledRecords[0][1])).toMatchObject({
      failurePhase: 'trpc_handler',
      outcome: 'failed',
      response: { httpStatus: 200 },
    });
  });
});
