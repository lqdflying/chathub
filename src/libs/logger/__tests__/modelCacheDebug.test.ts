import type { ModelCacheDiagnosticEvent } from '@lobechat/model-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createModelCacheDiagnosticContext,
  createTrustedPromptCacheKey,
  protectExternalToolsDiagnosticId,
} from '../modelCacheDebug';

describe('model cache diagnostic logging', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubEnv('DEBUG_OPENAI_CACHE', '1');
    vi.stubEnv('DEBUG_OPENAICOMPATIBLE_CACHE', '1');
    vi.stubEnv('KEY_VAULTS_SECRET', 'deployment-fingerprint-secret');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('creates stable deployment-keyed native prompt cache keys', () => {
    const firstKey = createTrustedPromptCacheKey({
      fallback: { prompt: 'PRIVATE_PROMPT' },
      sessionId: 'private-session',
      topicId: 'private-topic',
      userId: 'private-user',
    });
    const repeatedKey = createTrustedPromptCacheKey({
      fallback: { prompt: 'DIFFERENT_PRIVATE_PROMPT' },
      sessionId: 'private-session',
      topicId: 'private-topic',
      userId: 'private-user',
    });
    const differentUserKey = createTrustedPromptCacheKey({
      fallback: { prompt: 'PRIVATE_PROMPT' },
      sessionId: 'private-session',
      topicId: 'private-topic',
      userId: 'different-private-user',
    });

    expect(firstKey).toMatch(/^ch_[\da-f]{32}$/);
    expect(repeatedKey).toBe(firstKey);
    expect(differentUserKey).not.toBe(firstKey);
    expect(firstKey).not.toMatch(/private|prompt|session|topic|user/i);
  });

  it('fingerprints differences beyond the previous 256 KiB boundary', () => {
    const sharedPrefix = 'x'.repeat(256 * 1024);
    const firstFallback = { prompt: `${sharedPrefix}FIRST_SUFFIX` };
    const secondFallback = { prompt: `${sharedPrefix}SECOND_SUFFIX` };
    const context = createModelCacheDiagnosticContext({
      provider: 'openai',
      runtimeFamily: 'openai',
    });

    expect(context?.fingerprint('request', firstFallback)).not.toBe(
      context?.fingerprint('request', secondFallback),
    );
    expect(
      createTrustedPromptCacheKey({
        fallback: firstFallback,
        userId: 'private-user',
      }),
    ).not.toBe(
      createTrustedPromptCacheKey({
        fallback: secondFallback,
        userId: 'private-user',
      }),
    );
  });

  it('creates stable deployment-keyed tool diagnostic identifiers', () => {
    const diagnosticId = 'td_PRIVATE_PROMPT_DATA_123';
    const firstProtectedId = protectExternalToolsDiagnosticId(diagnosticId);
    const repeatedProtectedId = protectExternalToolsDiagnosticId(diagnosticId);
    const differentProtectedId = protectExternalToolsDiagnosticId('td_DIFFERENT_PRIVATE_DATA');

    expect(firstProtectedId).toMatch(/^td_[\da-f]{32}$/);
    expect(repeatedProtectedId).toBe(firstProtectedId);
    expect(differentProtectedId).not.toBe(firstProtectedId);
    expect(firstProtectedId).not.toContain('PRIVATE_PROMPT_DATA');
  });

  it('emits allowlisted cache events once without raw or attacker-controlled data', () => {
    const context = createModelCacheDiagnosticContext({
      continuation: {
        batchId: 'tb_1234567890abcdefghij',
        continuationId: 'tc_1234567890abcdefghij',
        expectedToolCallCount: 1,
        resultCount: 1,
      },
      provider: 'openai',
      runtimeFamily: 'openai',
      toolCache: {
        toolCallCount: 1,
        toolCallSetHash: '0123456789abcdef',
      },
    });
    const event = {
      apiType: 'chat-completions',
      attackerControlled: 'RAW_ATTACKER_FIELD',
      cacheMechanism: 'request-key',
      cachePolicy: {
        nestedAttackerControlled: 'RAW_NESTED_FIELD',
        promptCacheKey: true,
      },
      cacheSupport: 'supported',
      inputItemCount: 2,
      modelHash: context?.fingerprint('model', 'private-model-name'),
      prompt: 'PRIVATE_PROMPT',
      rawCacheKey: 'PRIVATE_CACHE_KEY',
      requestHash: context?.fingerprint('request', {
        prompt: 'PRIVATE_PROMPT',
        toolName: 'private-tool-name',
      }),
      stream: true,
      toolCount: 1,
      type: 'request',
    } as ModelCacheDiagnosticEvent;

    context?.emit(event);
    context?.emit(event);

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const [prefix, serializedRecord] = consoleLogSpy.mock.calls[0];
    const record = JSON.parse(serializedRecord);
    expect(context?.continuation?.batchId).toMatch(/^tb_[\da-f]{32}$/);
    expect(context?.continuation?.continuationId).toMatch(/^tc_[\da-f]{32}$/);
    expect(context?.continuation?.batchId).not.toBe('tb_1234567890abcdefghij');
    expect(context?.continuation?.continuationId).not.toBe('tc_1234567890abcdefghij');
    expect(prefix).toBe('[model-cache-debug:request]');
    expect(record).toMatchObject({
      apiType: 'chat-completions',
      cacheMechanism: 'request-key',
      cachePolicy: { promptCacheKey: true },
      cacheSupport: 'supported',
      continuation: {
        expectedToolCallCount: 1,
        resultCount: 1,
      },
      provider: 'openai',
      runtimeFamily: 'openai',
      stream: true,
      toolCache: {
        toolCallCount: 1,
        toolCallSetHash: '0123456789abcdef',
      },
      type: 'request',
    });
    expect(serializedRecord).not.toMatch(
      /RAW_ATTACKER_FIELD|RAW_NESTED_FIELD|PRIVATE_PROMPT|PRIVATE_CACHE_KEY|private-model-name|private-tool-name|tb_1234567890abcdefghij|tc_1234567890abcdefghij/,
    );
    expect(record).not.toHaveProperty('attackerControlled');
    expect(record.cachePolicy).not.toHaveProperty('nestedAttackerControlled');
  });

  it('preserves the legacy OpenAI-compatible namespace with the shared schema', () => {
    const context = createModelCacheDiagnosticContext({
      provider: 'openaicompatible',
      runtimeFamily: 'openai-compatible',
    });

    context?.emit({
      apiType: 'responses',
      cacheStatus: 'not_reported',
      cacheSupport: 'supported',
      reason: 'provider_omitted_usage',
      requestHash: '0123456789abcdef0123456789abcdef',
      type: 'usage_missing',
    });

    expect(consoleLogSpy.mock.calls[0][0]).toBe('[openai-compatible-cache-debug:usage_missing]');
    expect(JSON.parse(consoleLogSpy.mock.calls[0][1])).toMatchObject({
      cacheStatus: 'not_reported',
      provider: 'openaicompatible',
      reason: 'provider_omitted_usage',
      type: 'usage_missing',
    });
  });

  it('emits bounded Anthropic cache breakpoint policy fields', () => {
    vi.stubEnv('DEBUG_ANTHROPIC_CACHE', '1');
    const context = createModelCacheDiagnosticContext({
      provider: 'anthropic',
      runtimeFamily: 'anthropic',
    });

    context?.emit({
      apiType: 'anthropic-messages',
      cacheMechanism: 'explicit-breakpoint',
      cachePolicy: {
        cacheControl: true,
        cacheControlBreakpointCount: 3,
        cacheTTL: '5m',
      },
      cacheSupport: 'supported',
      inputItemCount: 2,
      requestHash: '0123456789abcdef0123456789abcdef',
      stream: true,
      toolCount: 1,
      type: 'request',
    });

    expect(JSON.parse(consoleLogSpy.mock.calls[0][1] as string)).toMatchObject({
      cachePolicy: {
        cacheControl: true,
        cacheControlBreakpointCount: 3,
        cacheTTL: '5m',
      },
      provider: 'anthropic',
      type: 'request',
    });
  });

  it('normalizes unsafe terminal error classes and omits raw error content', () => {
    const context = createModelCacheDiagnosticContext({
      provider: 'openai',
      runtimeFamily: 'openai',
    });

    context?.emit({
      apiType: 'responses',
      errorClass: 'PRIVATE_ERROR_MESSAGE https://secret.example.com',
      errorCode: 'UPSTREAM_ERROR',
      requestHash: '0123456789abcdef0123456789abcdef',
      terminalReason: 'unexpected_end',
      terminalSource: 'missing_terminal_event',
      type: 'terminal_error',
    });

    const serializedRecord = consoleLogSpy.mock.calls[0][1] as string;
    expect(JSON.parse(serializedRecord)).toMatchObject({
      errorClass: 'ProviderError',
      errorCode: 'UPSTREAM_ERROR',
      terminalReason: 'unexpected_end',
      terminalSource: 'missing_terminal_event',
      type: 'terminal_error',
    });
    expect(serializedRecord).not.toMatch(/PRIVATE_ERROR_MESSAGE|secret\.example\.com/);
  });
});
