import { describe, expect, it, vi } from 'vitest';

import type { ModelCacheDiagnosticContext, ModelCacheDiagnosticEvent } from '../../types';
import {
  createModelCacheDiagnosticCallbacks,
  emitModelCacheRequest,
  resolveModelCacheStatus,
} from './events';

const createDiagnosticContext = () => {
  const events: ModelCacheDiagnosticEvent[] = [];
  const context: ModelCacheDiagnosticContext = {
    emit: (event) => events.push(event),
    fingerprint: (scope) => `${scope}-fingerprint`,
    provider: 'openai',
    runtimeFamily: 'openai',
  };

  return { context, events };
};

describe('model cache diagnostic events', () => {
  it('classifies cache usage without treating unavailable counters as misses', () => {
    expect(resolveModelCacheStatus({}, 'supported')).toBe('not_reported');
    expect(resolveModelCacheStatus({ inputCachedTokens: 0 }, 'supported')).toBe('miss');
    expect(resolveModelCacheStatus({ inputCachedTokens: 100 }, 'supported')).toBe('hit');
    expect(
      resolveModelCacheStatus({ inputCacheMissTokens: 20, inputCachedTokens: 80 }, 'supported'),
    ).toBe('mixed');
    expect(resolveModelCacheStatus({ inputWriteCacheTokens: 100 }, 'supported')).toBe('write');
    expect(resolveModelCacheStatus({ inputCachedTokens: 100 }, 'unsupported')).toBe('unsupported');
  });

  it('emits a bounded request event without exposing fingerprint source values', () => {
    const { context, events } = createDiagnosticContext();

    const requestHash = emitModelCacheRequest(context, {
      apiType: 'chat-completions',
      cacheMechanism: 'request-key',
      cachePolicy: { promptCacheKey: true },
      cacheSupport: 'supported',
      inputItemCount: 2,
      model: 'private-model-name',
      requestFingerprintSource: {
        messages: [{ content: 'PRIVATE_PROMPT', role: 'user' }],
      },
      stream: true,
      toolCount: 1,
    });

    expect(requestHash).toBe('request-fingerprint');
    expect(events).toEqual([
      expect.objectContaining({
        modelHash: 'model-fingerprint',
        requestHash: 'request-fingerprint',
        type: 'request',
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_PROMPT');
    expect(JSON.stringify(events)).not.toContain('private-model-name');
  });

  it('emits one final usage event or an explicit missing-usage event', async () => {
    const { context, events } = createDiagnosticContext();
    const callbacks = createModelCacheDiagnosticCallbacks(context, {
      apiType: 'responses',
      cacheSupport: 'supported',
      requestHash: 'request-fingerprint',
    });

    await callbacks?.onFinal?.({
      text: '',
      usage: {
        inputCacheMissTokens: 20,
        inputCachedTokens: 80,
        totalInputTokens: 100,
        totalOutputTokens: 10,
        totalTokens: 110,
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        cacheStatus: 'mixed',
        responseHash: 'response-fingerprint',
        type: 'usage',
      }),
    ]);

    events.length = 0;
    const missingUsageCallbacks = createModelCacheDiagnosticCallbacks(context, {
      apiType: 'responses',
      cacheSupport: 'supported',
      requestHash: 'request-fingerprint',
    });
    await missingUsageCallbacks?.onFinal?.({ text: '' });
    expect(events).toEqual([
      expect.objectContaining({
        cacheStatus: 'not_reported',
        reason: 'provider_omitted_usage',
        type: 'usage_missing',
      }),
    ]);
  });

  it('emits one terminal error and suppresses missing usage after a stream failure', async () => {
    const { context, events } = createDiagnosticContext();
    const callbacks = createModelCacheDiagnosticCallbacks(context, {
      apiType: 'responses',
      cacheSupport: 'supported',
      requestHash: 'request-fingerprint',
    });

    await callbacks?.onError?.({
      code: 'UPSTREAM_FAILED',
      message: 'PRIVATE_PROVIDER_MESSAGE',
      name: 'ProviderStreamError',
    });
    await callbacks?.onFinal?.({ text: '' });

    expect(events).toEqual([
      expect.objectContaining({
        errorClass: 'ProviderError',
        errorCode: 'UPSTREAM_FAILED',
        requestHash: 'request-fingerprint',
        type: 'terminal_error',
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_PROVIDER_MESSAGE');
  });

  it('does not construct callbacks when diagnostics are disabled', () => {
    const callbackSpy = vi.fn();

    expect(
      createModelCacheDiagnosticCallbacks(undefined, {
        apiType: 'unknown',
        cacheSupport: 'unsupported',
      }),
    ).toBeUndefined();
    expect(callbackSpy).not.toHaveBeenCalled();
  });
});
