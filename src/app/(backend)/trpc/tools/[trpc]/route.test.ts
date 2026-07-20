import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHATHUB_TOOLS_DIAGNOSTIC_HEADER } from '@/const/tools';

import { POST } from './route';

const { fetchRequestHandlerMock } = vi.hoisted(() => ({
  fetchRequestHandlerMock: vi.fn(),
}));

vi.mock('@trpc/server/adapters/fetch', () => ({
  fetchRequestHandler: fetchRequestHandlerMock,
}));
vi.mock('@/libs/logger', () => ({
  pino: { info: vi.fn() },
}));
vi.mock('@/libs/trpc/lambda/context', () => ({ createLambdaContext: vi.fn() }));
vi.mock('@/server/routers/tools', () => ({ toolsRouter: {} }));

describe('Tools tRPC diagnostics ingress', () => {
  beforeEach(() => {
    vi.stubEnv('CHATHUB_TOOLS_DEBUG', '1');
    vi.stubEnv('KEY_VAULTS_SECRET', 'test-deployment-fingerprint-secret');
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

  it('protects an external diagnostic header before route logging', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const externalDiagnosticId = 'td_PRIVATE_PROMPT_DATA_123';
    const request = new NextRequest('http://localhost/trpc/tools/telemetry.reportToolBatch', {
      body: '{}',
      headers: {
        [CHATHUB_TOOLS_DIAGNOSTIC_HEADER]: externalDiagnosticId,
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    const response = await POST(request);

    expect(response.headers.get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER)).toMatch(/^td_[\da-f]{32}$/);
    expect(fetchRequestHandlerMock).toHaveBeenCalledTimes(1);
    const diagnosticOutput = JSON.stringify(consoleSpy.mock.calls);
    expect(diagnosticOutput).toContain('[chathub-tools-debug:tools_rpc_started]');
    expect(diagnosticOutput).toContain('[chathub-tools-debug:tools_rpc_complete]');
    expect(diagnosticOutput).not.toContain(externalDiagnosticId);
  });
});
