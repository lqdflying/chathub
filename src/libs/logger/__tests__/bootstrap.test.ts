import debug from 'debug';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bootstrapDebug,
  getPinoLevel,
  parseToolsDebugLevel,
  TOOLS_SAFE_NS,
  TOOLS_VERBOSE_NS,
} from '../bootstrap';

const clearDebugEnv = () => {
  delete process.env.CHATHUB_DEBUG;
  delete process.env.CHATHUB_TOOLS_DEBUG;
  delete process.env.DEBUG;
  delete process.env.LOG_LEVEL;
};

describe('parseToolsDebugLevel', () => {
  it('parses off values', () => {
    for (const v of [undefined, '', '0', 'false', 'off', ' OFF ', 'FALSE']) {
      expect(parseToolsDebugLevel(v)).toBe('off');
    }
  });

  it('parses safe values', () => {
    for (const v of ['1', 'true', 'on', 'safe', ' SAFE ', 'TRUE']) {
      expect(parseToolsDebugLevel(v)).toBe('safe');
    }
  });

  it('parses verbose values', () => {
    for (const v of ['2', 'verbose', ' VERBOSE ']) {
      expect(parseToolsDebugLevel(v)).toBe('verbose');
    }
  });

  it('returns off for unrecognized values', () => {
    expect(parseToolsDebugLevel('yes')).toBe('off');
    expect(parseToolsDebugLevel('enabled')).toBe('off');
  });
});

describe('bootstrapDebug', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let enableSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    clearDebugEnv();
    enableSpy = vi.spyOn(debug, 'enable');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('should not enable any namespaces when CHATHUB_TOOLS_DEBUG is unset and DEBUG is empty', () => {
    bootstrapDebug();

    expect(enableSpy).not.toHaveBeenCalled();
  });

  it('should not auto-enable namespaces for CHATHUB_DEBUG=1 alone', () => {
    process.env.CHATHUB_DEBUG = '1';

    bootstrapDebug();

    expect(enableSpy).not.toHaveBeenCalled();
  });

  it('should pass through existing DEBUG namespaces', () => {
    process.env.DEBUG = 'existing:ns';

    bootstrapDebug();

    expect(enableSpy).toHaveBeenCalledWith('existing:ns');
  });

  it('should enable the safe set when CHATHUB_TOOLS_DEBUG=1', () => {
    process.env.CHATHUB_TOOLS_DEBUG = '1';

    bootstrapDebug();

    expect(enableSpy).toHaveBeenCalledWith(TOOLS_SAFE_NS.join(','));
    expect(enableSpy).not.toHaveBeenCalledWith(expect.stringContaining(TOOLS_VERBOSE_NS[0]));
  });

  it('should merge safe set with existing DEBUG namespaces, deduped', () => {
    process.env.DEBUG = `foo:*,${TOOLS_SAFE_NS[0]}`;
    process.env.CHATHUB_TOOLS_DEBUG = '1';

    bootstrapDebug();

    const called = enableSpy.mock.calls[0][0] as string;
    const parts = called.split(',');
    expect(parts[0]).toBe('foo:*');
    // safe set present, and the overlapping namespace is not duplicated
    expect(parts.filter((p) => p === TOOLS_SAFE_NS[0])).toHaveLength(1);
    for (const ns of TOOLS_SAFE_NS) expect(parts).toContain(ns);
  });

  it('should enable safe + verbose sets when CHATHUB_TOOLS_DEBUG=verbose', () => {
    process.env.CHATHUB_TOOLS_DEBUG = 'verbose';

    bootstrapDebug();

    const called = enableSpy.mock.calls[0][0] as string;
    const parts = called.split(',');
    for (const ns of [...TOOLS_SAFE_NS, ...TOOLS_VERBOSE_NS]) expect(parts).toContain(ns);
  });

  it('should merge verbose sets with existing DEBUG namespaces, deduped', () => {
    process.env.DEBUG = 'foo:*';
    process.env.CHATHUB_TOOLS_DEBUG = 'verbose';

    bootstrapDebug();

    const called = enableSpy.mock.calls[0][0] as string;
    const parts = called.split(',');
    expect(new Set(parts).size).toBe(parts.length);
    expect(parts[0]).toBe('foo:*');
    for (const ns of [...TOOLS_SAFE_NS, ...TOOLS_VERBOSE_NS]) expect(parts).toContain(ns);
  });

  it('should warn once and treat unrecognized CHATHUB_TOOLS_DEBUG as off', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.CHATHUB_TOOLS_DEBUG = 'yes';

    bootstrapDebug();

    expect(enableSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('should never auto-enable provider raw-stream env var names', () => {
    // Provider-specific raw payload flags are env vars (e.g.
    // DEBUG_OPENAI_CHAT_COMPLETION=1), not debug namespaces. They must never
    // appear in any curated set; only explicit DEBUG=... can enable them.
    const forbiddenEnvVars = [
      'DEBUG_OPENAI_CHAT_COMPLETION',
      'DEBUG_ANTHROPIC_CHAT_COMPLETION',
      'DEBUG_MOONSHOT_CHAT_COMPLETION',
      'DEBUG_MINIMAX_CHAT_COMPLETION',
      'DEBUG_DEEPSEEK_CHAT_COMPLETION',
      'DEBUG_GOOGLE_CHAT_COMPLETION',
      'DEBUG_AZURE_CHAT_COMPLETION',
      'DEBUG_AZURE_AI_CHAT_COMPLETION',
    ];

    for (const ns of [...TOOLS_SAFE_NS, ...TOOLS_VERBOSE_NS]) {
      expect(forbiddenEnvVars).not.toContain(ns);
    }

    // Explicit passthrough still works when set via DEBUG=...
    for (const ns of forbiddenEnvVars) {
      enableSpy.mockClear();
      process.env.DEBUG = ns;
      bootstrapDebug();
      expect(enableSpy).toHaveBeenCalledWith(ns);
    }
  });
});

describe('getPinoLevel', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    clearDebugEnv();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return explicit LOG_LEVEL when set', () => {
    process.env.LOG_LEVEL = 'warn';

    expect(getPinoLevel()).toBe('warn');
  });

  it('should respect explicit LOG_LEVEL over CHATHUB_DEBUG and CHATHUB_TOOLS_DEBUG', () => {
    process.env.LOG_LEVEL = 'error';
    process.env.CHATHUB_DEBUG = '1';
    process.env.CHATHUB_TOOLS_DEBUG = 'verbose';

    expect(getPinoLevel()).toBe('error');
  });

  it('should default to debug when CHATHUB_DEBUG=1 and no LOG_LEVEL', () => {
    process.env.CHATHUB_DEBUG = '1';

    expect(getPinoLevel()).toBe('debug');
  });

  it('should default to debug when CHATHUB_TOOLS_DEBUG=1', () => {
    process.env.CHATHUB_TOOLS_DEBUG = '1';

    expect(getPinoLevel()).toBe('debug');
  });

  it('should default to debug when CHATHUB_TOOLS_DEBUG=verbose', () => {
    process.env.CHATHUB_TOOLS_DEBUG = 'verbose';

    expect(getPinoLevel()).toBe('debug');
  });

  it('should default to info when no debug flags are set and no LOG_LEVEL', () => {
    expect(getPinoLevel()).toBe('info');
  });

  it('should default to info when CHATHUB_TOOLS_DEBUG is off', () => {
    process.env.CHATHUB_TOOLS_DEBUG = '0';

    expect(getPinoLevel()).toBe('info');
  });
});
