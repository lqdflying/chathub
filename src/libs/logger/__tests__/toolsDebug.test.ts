import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const legacyLogs = vi.hoisted(() => ({
  safe: vi.fn(),
  verbose: vi.fn(),
}));

vi.mock('debug', () => ({
  default: vi.fn((namespace: string) => {
    const logger = namespace === 'chathub-tools:safe' ? legacyLogs.safe : legacyLogs.verbose;
    return Object.assign(logger, { enabled: true });
  }),
}));

import {
  fingerprintToolsDebugValue,
  logToolsDebugSafe,
  logToolsDebugVerbose,
  runWithToolsDebugContext,
} from '../toolsDebug';

describe('structured tools debug logging', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalToolsDebug: string | undefined;

  beforeEach(() => {
    originalToolsDebug = process.env.CHATHUB_TOOLS_DEBUG;
    delete process.env.CHATHUB_TOOLS_DEBUG;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalToolsDebug === undefined) delete process.env.CHATHUB_TOOLS_DEBUG;
    else process.env.CHATHUB_TOOLS_DEBUG = originalToolsDebug;
    vi.restoreAllMocks();
    legacyLogs.safe.mockClear();
    legacyLogs.verbose.mockClear();
  });

  it('emits safe events as prefixed JSON without a legacy duplicate', () => {
    process.env.CHATHUB_TOOLS_DEBUG = '1';

    logToolsDebugSafe('list_tools_complete', {
      count: 2,
      durationMs: 17,
      runtimeType: 'mcp',
    });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const [prefix, json] = consoleLogSpy.mock.calls[0];
    expect(prefix).toBe('[chathub-tools-debug:list_tools_complete]');
    expect(JSON.parse(json)).toMatchObject({
      count: 2,
      debugLevel: 'safe',
      durationMs: 17,
      runtimeType: 'mcp',
      schemaVersion: 2,
    });
    expect(JSON.parse(json).timestamp).toEqual(expect.any(String));
    expect(legacyLogs.safe).not.toHaveBeenCalled();
  });

  it('emits safe and sanitized verbose records at verbose level', () => {
    process.env.CHATHUB_TOOLS_DEBUG = 'verbose';

    logToolsDebugSafe('client_initialized', { transport: 'http' });
    logToolsDebugVerbose('call_tool', {
      apiKey: 'super-secret',
      args: { query: 'private search' },
      toolName: 'private-tool',
    });

    expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy.mock.calls[0][0]).toBe('[chathub-tools-debug:client_initialized]');
    expect(JSON.parse(consoleLogSpy.mock.calls[0][1])).toMatchObject({
      debugLevel: 'safe',
      schemaVersion: 2,
      transport: 'http',
    });

    const [prefix, json] = consoleLogSpy.mock.calls[1];
    expect(prefix).toBe('[chathub-tools-debug:call_tool]');
    expect(JSON.parse(json)).toMatchObject({ debugLevel: 'verbose' });
    expect(json).not.toMatch(/super-secret|private search|private-tool|toolName|query/);
    expect(legacyLogs.safe).not.toHaveBeenCalled();
    expect(legacyLogs.verbose).not.toHaveBeenCalled();
  });

  it('keeps verbose events out of structured safe mode', () => {
    process.env.CHATHUB_TOOLS_DEBUG = 'safe';

    logToolsDebugVerbose('call_tool_result', { text: 'private result' });

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(legacyLogs.verbose).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(legacyLogs.verbose.mock.calls)).not.toContain('private result');
  });

  it('uses the legacy namespace fallback when structured logging is off', () => {
    logToolsDebugSafe('call_tool_complete', { durationMs: 4 });

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(legacyLogs.safe).toHaveBeenCalledTimes(1);
    expect(legacyLogs.safe.mock.calls[0][0]).toBe('event=%s payload=%O');
    expect(legacyLogs.safe.mock.calls[0][1]).toBe('call_tool_complete');
    expect(legacyLogs.safe.mock.calls[0][2]).toMatchObject({
      debugLevel: 'safe',
      durationMs: 4,
      schemaVersion: 2,
    });
  });

  it('falls back to a minimal record when JSON serialization fails', () => {
    process.env.CHATHUB_TOOLS_DEBUG = '1';
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      logToolsDebugSafe('call_tool_complete', circular as { durationMs: number }),
    ).not.toThrow();

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const [prefix, json] = consoleLogSpy.mock.calls[0];
    expect(prefix).toBe('[chathub-tools-debug:call_tool_complete]');
    expect(JSON.parse(json)).toMatchObject({
      debugLevel: 'safe',
      schemaVersion: 2,
    });
    expect(json).toContain('truncated:max-depth');
  });

  it('does not let payload sanitization failures interrupt tool behavior', () => {
    process.env.CHATHUB_TOOLS_DEBUG = 'verbose';
    const payload = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('private proxy failure');
        },
      },
    );

    expect(() => logToolsDebugVerbose('call_tool_result', payload)).not.toThrow();

    const [prefix, json] = consoleLogSpy.mock.calls[0];
    expect(prefix).toBe('[chathub-tools-debug:call_tool_result]');
    expect(JSON.parse(json)).toMatchObject({
      debugLevel: 'verbose',
      payload: { type: 'unavailable' },
      schemaVersion: 2,
    });
    expect(json).not.toContain('private proxy failure');
  });

  it('does not let safe-record sanitization failures interrupt tool behavior', () => {
    process.env.CHATHUB_TOOLS_DEBUG = '1';
    const fields = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('private safe-record failure');
        },
      },
    );

    expect(() => logToolsDebugSafe('call_tool_failed', fields)).not.toThrow();

    const [prefix, json] = consoleLogSpy.mock.calls[0];
    expect(prefix).toBe('[chathub-tools-debug:call_tool_failed]');
    expect(JSON.parse(json)).toMatchObject({
      debugLevel: 'safe',
      recordSanitizationFailed: true,
      schemaVersion: 2,
    });
    expect(json).not.toContain('private safe-record failure');
  });

  it('correlates events with a diagnostic id and monotonic sequence', () => {
    process.env.CHATHUB_TOOLS_DEBUG = '1';

    runWithToolsDebugContext(
      {
        connectionHash: 'abcdef0123456789',
        diagnosticId: 'td_1234567890abcdef',
        operation: 'call_tool',
        toolName: 'tavily_search',
        transport: 'http',
      },
      () => {
        logToolsDebugSafe('call_tool_started', { phase: 'start' });
        logToolsDebugSafe('call_tool_complete', { phase: 'serialization' });
      },
    );

    const first = JSON.parse(consoleLogSpy.mock.calls[0][1]);
    const second = JSON.parse(consoleLogSpy.mock.calls[1][1]);
    expect(first).toMatchObject({
      connectionHash: 'abcdef0123456789',
      diagnosticId: 'td_1234567890abcdef',
      eventSequence: 1,
      operation: 'call_tool',
      toolName: 'tavily_search',
    });
    expect(second.eventSequence).toBe(2);
    expect(first.spanId).toMatch(/^ts_[\da-f]{16}$/);
    expect(second.spanId).toBe(first.spanId);
  });

  it('drops credential fields and never emits raw arbitrary payload strings', () => {
    process.env.CHATHUB_TOOLS_DEBUG = '1';

    logToolsDebugSafe('transport_request_failed', {
      apiKey: 'private-api-key',
      authorization: 'Bearer private-token',
      connectionId: 'private-connection-id',
      cookie: 'session=private-cookie',
      credentialConfigured: true,
      code: 'oauth-private-code',
      endpoint: 'https://mcp.example.com/safe-path',
      errorCode: 'ECONNRESET',
      errorMessage: 'Unexpected token at <!DOCTYPE private-html>',
      nested: { refreshToken: 'private-refresh-token', value: 'private-payload' },
      trpcCode: 'INTERNAL_SERVER_ERROR',
      userId: 123_456_789,
    });

    const json = consoleLogSpy.mock.calls[0][1] as string;
    expect(json).not.toMatch(
      /private-api-key|private-token|private-connection-id|private-cookie|private-refresh-token|private-payload|oauth-private-code|123456789|<!DOCTYPE/,
    );
    expect(JSON.parse(json)).toMatchObject({
      credentialConfigured: true,
      endpoint: 'https://mcp.example.com/safe-path',
      errorCode: 'ECONNRESET',
      trpcCode: 'INTERNAL_SERVER_ERROR',
    });
    expect(JSON.parse(json).connectionId).toMatchObject({ type: 'identifier' });
    expect(JSON.parse(json).userId).toMatchObject({ type: 'identifier' });
  });

  it('fingerprints values deterministically while excluding secret-keyed values', () => {
    expect(
      fingerprintToolsDebugValue({ apiKey: 'first-secret', name: 'connection' }),
    ).toBe(fingerprintToolsDebugValue({ apiKey: 'second-secret', name: 'connection' }));
  });
});
