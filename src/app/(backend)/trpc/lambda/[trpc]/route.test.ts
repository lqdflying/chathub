import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHATHUB_RPC_DIAGNOSTIC_OPERATION_HEADER,
  CHATHUB_TOOLS_DIAGNOSTIC_HEADER,
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
vi.mock('@/libs/trpc/lambda/context', () => ({ createLambdaContext: vi.fn() }));
vi.mock('@/server/routers/lambda', () => ({ lambdaRouter: {} }));

const previousDebug = process.env.CHATHUB_TOOLS_DEBUG;

describe('Lambda tRPC message-update diagnostics', () => {
  beforeEach(() => {
    process.env.CHATHUB_TOOLS_DEBUG = '1';
    process.env.KEY_VAULTS_SECRET = 'test-deployment-fingerprint-secret';
    fetchRequestHandlerMock.mockResolvedValue(
      new Response('{"result":{"data":{"json":null}}}', {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.KEY_VAULTS_SECRET;
    if (previousDebug === undefined) delete process.env.CHATHUB_TOOLS_DEBUG;
    else process.env.CHATHUB_TOOLS_DEBUG = previousDebug;
  });

  it('correlates and fingerprints an instrumented message update', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const request = new NextRequest('http://localhost/trpc/lambda/message.update', {
      body: '{}',
      headers: {
        [CHATHUB_RPC_DIAGNOSTIC_OPERATION_HEADER]: 'persist_tool_result',
        [CHATHUB_TOOLS_DIAGNOSTIC_HEADER]: 'td_1234567890abcdef',
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    const response = await POST(request);

    expect(response.headers.get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER)).toMatch(/^td_[\da-f]{32}$/);
    expect(fetchRequestHandlerMock).toHaveBeenCalledTimes(1);
    const startedEvent = consoleSpy.mock.calls.find(
      ([prefix]) => prefix === '[chathub-tools-debug:tool_persistence_rpc_started]',
    );
    const completedEvent = consoleSpy.mock.calls.find(
      ([prefix]) => prefix === '[chathub-tools-debug:tool_persistence_rpc_complete]',
    );
    expect(startedEvent?.[1]).toContain('message.update');
    expect(completedEvent?.[1]).toContain('responseFingerprint');
    expect(completedEvent?.[1]).not.toContain('{"result"');
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('td_1234567890abcdef');
    consoleSpy.mockRestore();
  });

  it('records an ordinary assistant finalization without logging its request payload', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const privateMessageContent = 'private assistant response';
    const request = new NextRequest('http://localhost/trpc/lambda/message.update', {
      body: JSON.stringify({
        id: 'private-message-id',
        value: { content: privateMessageContent },
      }),
      headers: {
        [CHATHUB_RPC_DIAGNOSTIC_OPERATION_HEADER]: 'finalize_assistant_message',
        [CHATHUB_TOOLS_DIAGNOSTIC_HEADER]: 'td_assistantfinalization1234',
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    const response = await POST(request);

    expect(response.headers.get(CHATHUB_TOOLS_DIAGNOSTIC_HEADER)).toMatch(/^td_[\da-f]{32}$/);
    const startedEvent = consoleSpy.mock.calls.find(
      ([prefix]) => prefix === '[chathub-tools-debug:assistant_finalization_rpc_started]',
    );
    const completedEvent = consoleSpy.mock.calls.find(
      ([prefix]) => prefix === '[chathub-tools-debug:assistant_finalization_rpc_complete]',
    );
    expect(startedEvent?.[1]).toContain('finalize_assistant_message');
    expect(startedEvent?.[1]).toContain('message.update');
    expect(completedEvent?.[1]).toContain('responseFingerprint');
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(privateMessageContent);
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('private-message-id');
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('td_assistantfinalization1234');
    consoleSpy.mockRestore();
  });

  it('does not emit tool diagnostics without a valid correlation header', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const request = new NextRequest('http://localhost/trpc/lambda/message.update', {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    await POST(request);

    expect(
      consoleSpy.mock.calls.some(([prefix]) =>
        String(prefix).includes('tool_persistence_rpc_started'),
      ),
    ).toBe(false);
    consoleSpy.mockRestore();
  });

  it('does not emit diagnostics for an unrecognized operation', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const request = new NextRequest('http://localhost/trpc/lambda/message.update', {
      body: '{}',
      headers: {
        [CHATHUB_RPC_DIAGNOSTIC_OPERATION_HEADER]: 'private_operation',
        [CHATHUB_TOOLS_DIAGNOSTIC_HEADER]: 'td_1234567890abcdef',
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    await POST(request);

    expect(consoleSpy.mock.calls.some(([prefix]) => String(prefix).includes('_rpc_started'))).toBe(
      false,
    );
    consoleSpy.mockRestore();
  });
});
