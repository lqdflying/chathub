/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createConversationRuntimeChatOptions } from './runtimeChatOptions';

describe('createConversationRuntimeChatOptions', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('attaches cache diagnostics and a trusted prompt-cache key when enabled', () => {
    vi.stubEnv('DEBUG_OPENAI_CACHE', '1');
    vi.stubEnv('KEY_VAULTS_SECRET', 'conversation-cache-fingerprint-secret');

    const options = createConversationRuntimeChatOptions({
      payload: {
        messages: [{ content: 'PRIVATE_PROMPT', role: 'user' }],
        model: 'gpt-5.6',
        tools: [{ function: { name: 'lobe-web-browsing____search' } }],
      },
      provider: 'openai',
      sessionId: 'private-session',
      topicId: 'private-topic',
      userId: 'private-user',
    });

    expect(options.cacheDiagnosticsDisabled).toBeUndefined();
    expect(options.cacheDiagnostics?.provider).toBe('openai');
    expect(options.cacheDiagnostics?.runtimeFamily).toBe('openai');
    expect(options.runtimeProvider).toBe('openai');
    expect(options.user).toBe('private-user');
    expect(options.trustedPromptCacheKey).toMatch(/^ch_[\da-f]{32}$/);
    expect(JSON.stringify(options)).not.toMatch(/PRIVATE_PROMPT|private-session|private-topic/i);
  });

  it('marks cache diagnostics disabled when the switch is on without a fingerprint secret', () => {
    vi.stubEnv('DEBUG_OPENAI_CACHE', '1');
    vi.stubEnv('KEY_VAULTS_SECRET', '');
    vi.stubEnv('NEXT_AUTH_SECRET', '');

    const options = createConversationRuntimeChatOptions({
      payload: { model: 'gpt-5.6' },
      provider: 'openai',
      userId: 'private-user',
    });

    expect(options.cacheDiagnostics).toBeUndefined();
    expect(options.cacheDiagnosticsDisabled).toBe(true);
    expect(options.trustedPromptCacheKey).toBeUndefined();
  });

  it('omits cache diagnostics when the provider switch is off', () => {
    vi.stubEnv('DEBUG_OPENAI_CACHE', '0');
    vi.stubEnv('KEY_VAULTS_SECRET', 'conversation-cache-fingerprint-secret');

    const options = createConversationRuntimeChatOptions({
      payload: { model: 'gpt-5.6' },
      provider: 'openai',
      userId: 'private-user',
    });

    expect(options.cacheDiagnostics).toBeUndefined();
    expect(options.cacheDiagnosticsDisabled).toBeUndefined();
    expect(options.trustedPromptCacheKey).toMatch(/^ch_[\da-f]{32}$/);
  });

  it('protects tool-cache continuation identifiers before they reach ModelRuntime', () => {
    vi.stubEnv('DEBUG_MOONSHOT_CACHE', '1');
    vi.stubEnv('KEY_VAULTS_SECRET', 'conversation-cache-fingerprint-secret');

    const options = createConversationRuntimeChatOptions({
      payload: { model: 'kimi-k2.5' },
      provider: 'moonshot',
      toolCache: {
        batchId: 'tb_PRIVATE_BATCH',
        continuationId: 'tc_PRIVATE_CONTINUATION',
        resultCount: 1,
        toolCallCount: 1,
        toolCallSetHash: '0123456789abcdef',
      },
      userId: 'private-user',
    });

    expect(options.cacheDiagnostics?.toolCache?.batchId).toMatch(/^tb_[\da-f]{32}$/);
    expect(options.cacheDiagnostics?.continuation?.continuationId).toMatch(/^tc_[\da-f]{32}$/);
    expect(options.cacheDiagnostics?.toolCache?.batchId).not.toBe('tb_PRIVATE_BATCH');
    expect(JSON.stringify(options)).not.toMatch(/PRIVATE_BATCH|PRIVATE_CONTINUATION/);
  });
});
