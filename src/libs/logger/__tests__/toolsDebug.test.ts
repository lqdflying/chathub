import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const legacyLogs = vi.hoisted(() => ({
  safe: vi.fn(),
  verbose: vi.fn(),
}));

vi.mock('debug', () => ({
  default: vi.fn((namespace: string) =>
    namespace === 'chathub-tools:safe' ? legacyLogs.safe : legacyLogs.verbose,
  ),
}));

import { logToolsDebugSafe, logToolsDebugVerbose } from '../toolsDebug';

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

    logToolsDebugSafe('list_tools_complete', { count: 2, durationMs: 17 });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const [prefix, json] = consoleLogSpy.mock.calls[0];
    expect(prefix).toBe('[chathub-tools-debug:list_tools_complete]');
    expect(JSON.parse(json)).toEqual({
      count: 2,
      debugLevel: 'safe',
      durationMs: 17,
    });
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
    expect(JSON.parse(consoleLogSpy.mock.calls[0][1])).toEqual({
      debugLevel: 'safe',
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
    expect(legacyLogs.safe).toHaveBeenCalledWith(
      'event=%s payload=%O',
      'call_tool_complete',
      { debugLevel: 'safe', durationMs: 4 },
    );
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
    expect(JSON.parse(json)).toEqual({ debugLevel: 'safe', serializationError: true });
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
    expect(JSON.parse(json)).toEqual({
      debugLevel: 'verbose',
      payload: { type: 'unavailable' },
    });
    expect(json).not.toContain('private proxy failure');
  });
});
