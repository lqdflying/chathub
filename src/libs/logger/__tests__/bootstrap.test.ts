import debug from 'debug';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHATHUB_DEBUG_NAMESPACES,
  bootstrapDebug,
  getPinoLevel,
} from '../bootstrap';

describe('bootstrapDebug', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let enableSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    enableSpy = vi.spyOn(debug, 'enable');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('should be a no-op when CHATHUB_DEBUG is unset', () => {
    delete process.env.CHATHUB_DEBUG;

    bootstrapDebug();

    expect(enableSpy).not.toHaveBeenCalled();
  });

  it('should be a no-op when CHATHUB_DEBUG is not "1"', () => {
    process.env.CHATHUB_DEBUG = 'true';

    bootstrapDebug();

    expect(enableSpy).not.toHaveBeenCalled();
  });

  it('should enable default namespaces when CHATHUB_DEBUG=1 and DEBUG is empty', () => {
    process.env.CHATHUB_DEBUG = '1';
    delete process.env.DEBUG;

    bootstrapDebug();

    expect(enableSpy).toHaveBeenCalledWith(CHATHUB_DEBUG_NAMESPACES);
  });

  it('should merge with existing DEBUG namespaces', () => {
    process.env.CHATHUB_DEBUG = '1';
    process.env.DEBUG = 'existing:ns';

    bootstrapDebug();

    expect(enableSpy).toHaveBeenCalledWith(`existing:ns,${CHATHUB_DEBUG_NAMESPACES}`);
  });

  it('should not contain known-sensitive namespaces', () => {
    // These namespaces log sensitive data (tokens, API keys, prompts,
    // responses, user payloads, JWTs) and must NOT appear in the allowlist.
    const forbidden = [
      'context-engine:*',
      'lobe-image:*',
      'lobe-lambda-router:*',
      'lobe-mcp:client',
      'lobe-model-runtime:*',
      'lobe-next-auth:adapter',
      'lobe-oidc:adapter',
      'lobe-oidc:http-adapter',
      'lobe-oidc:provider',
      'lobe-search:*',
      'oidc-jwt',
    ];

    for (const ns of forbidden) {
      expect(CHATHUB_DEBUG_NAMESPACES).not.toContain(ns);
    }
  });

  it('should not contain provider raw-stream env var names', () => {
    // Provider-specific raw payload flags are env vars (e.g.
    // DEBUG_OPENAI_CHAT_COMPLETION=1), not debug namespaces, and must
    // never appear in the namespace list.
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

    for (const ns of forbiddenEnvVars) {
      expect(CHATHUB_DEBUG_NAMESPACES).not.toContain(ns);
    }
  });
});

describe('getPinoLevel', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return explicit LOG_LEVEL when set', () => {
    process.env.LOG_LEVEL = 'warn';
    delete process.env.CHATHUB_DEBUG;

    expect(getPinoLevel()).toBe('warn');
  });

  it('should override CHATHUB_DEBUG when LOG_LEVEL is explicit', () => {
    process.env.LOG_LEVEL = 'error';
    process.env.CHATHUB_DEBUG = '1';

    expect(getPinoLevel()).toBe('error');
  });

  it('should default to debug when CHATHUB_DEBUG=1 and no LOG_LEVEL', () => {
    delete process.env.LOG_LEVEL;
    process.env.CHATHUB_DEBUG = '1';

    expect(getPinoLevel()).toBe('debug');
  });

  it('should default to info when CHATHUB_DEBUG is unset and no LOG_LEVEL', () => {
    delete process.env.LOG_LEVEL;
    delete process.env.CHATHUB_DEBUG;

    expect(getPinoLevel()).toBe('info');
  });
});
